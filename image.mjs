/**
 * Responsive images: the attributes a page writes for an image (srcset, sizes, width, height and AVIF and WebP
 * sources) and the route that serves each size from the one original in R2 through the Images binding. The two halves
 * come from one `defineImages` call, so the page never asks for a size or a crop the route would refuse.
 *
 * Rules that guard decisions:
 * - The binding, not `/cdn-cgi/image/`: the URL interface needs a customer zone and answers 404 (error 1042) on
 *   workers.dev.
 * - Every set is CLOSED. The binding bills each unique source and parameter set once a month (5,000 free), so an open
 *   width, crop or focal point lets any caller mint billed transforms. Format and quality are not counted.
 * - The format is in the URL, never negotiated from `Accept`: the edge cache is keyed by URL alone. The page offers
 *   both through `<picture>`. A size URL ends in its own format's extension (`photo.jpg.webp?w=640`); `originalKey`
 *   gives the route the stored key back, and a URL with no such suffix still answers.
 * - Always pass quality 85 (Cloudflare's default): with none the binding writes lossless WebP.
 * - A stored SVG is script running as the site, so it is only served as an attachment, and every file carries
 *   UPLOAD_HEADERS (./headers: nosniff and a sandboxed policy; ASVS 5.4.1).
 * - A GIF's sizes stay animated (WebP, no AVIF: Cloudflare documents animation for WebP and GIF output only). Its first
 *   frame, `still=1`, is offered under prefers-reduced-motion (WCAG 2.2.2) from the same closed widths.
 * - A size URL is `immutable` for a year, so the page's URL carries the file's version (`v=`, from its stored hash or
 *   updated time). `v` is never in the edge cache key, so it mints no transform.
 * - Cloudflare encodes AVIF only up to 1,200 px on a side (developers.cloudflare.com/images/get-started/limits/), so
 *   the AVIF source names the WebP for a larger size, and an AVIF request answered in another format is sent to that
 *   format's URL: no URL named .avif holds a WebP.
 *
 * The widths, the sizes rule and the three layouts are Astro's (packages/astro/src/assets/layout.ts, Astro 7.4), under
 * its MIT license:
 *
 *   Copyright (c) 2021 Fred K. Schott
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 *   documentation files (the "Software"), to deal in the Software without restriction, including without limitation
 *   the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 *   permit persons to whom the Software is furnished to do so, subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in all copies or substantial portions of
 *   the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
 *   THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
 *   TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 *   SOFTWARE.
 */

import { applyHeaderSet, UPLOAD_HEADERS } from "./headers.mjs";
import { textResponse } from "./http.mjs";
import {
  IMAGE_FORMATS,
  IMAGE_QUALITY,
  RATIO,
  cropHeight,
  focusOf,
  imageVersion,
  isRasterPath,
  mediaKey,
  originalKey,
  versionedCache,
} from "./image-core.mjs";
import { respondImage } from "./image-respond.mjs";
import { retryR2Read } from "./r2-object.mjs";

export {
  FOCUS_METADATA,
  IMAGE_FORMATS,
  IMAGE_QUALITY,
  IMMUTABLE_CACHE,
  RASTER_PATH,
  RASTER_TYPES,
  assetsObject,
  focalPosition,
  focusOf,
  imageVersion,
  keyOfAddress,
  keysAtAddresses,
  mediaKey,
  originalKey,
  versionedCache,
} from "./image-core.mjs";
export { editImage } from "./image-edit.mjs";
export { imagePreload, pictureHtml, pictureProps } from "./image-markup.mjs";

/**
 * @typedef {{ body: ReadableStream, httpEtag: string, httpMetadata?: { contentType?: string }, customMetadata?: Record<string, string>, writeHttpMetadata(headers: Headers): void }} R2ObjectLike
 * @typedef {{ output(options: { format: string, quality?: number, anim?: boolean }): Promise<{ response(): Response }> }} ImagesOutput
 * @typedef {{ input(stream: ReadableStream): ImagesOutput & { transform(options: object): ImagesOutput } }} ImagesLike
 */

/** @typedef {"avif" | "webp"} ImageFormat */

/**
 * An image for a share tag or structured data: its URL, size and served type.
 * @typedef {object} SizedImageUrl
 * @property {string} url
 * @property {number} width
 * @property {number} height
 * @property {string} type
 */

/**
 * @typedef {object} ImageAttributes
 * @property {string} src
 * @property {string | undefined} srcset
 * @property {string | undefined} sizes
 * @property {Array<{ type: string; srcset: string; media?: string }>} sources AVIF then WebP, for a `<picture>`; empty when the image gets no srcset. A GIF's are its still first frame (AVIF then WebP, each with `media` "(prefers-reduced-motion: reduce)"), then the animated WebP.
 * @property {number | undefined} width
 * @property {number | undefined} height
 * @property {string | undefined} background The CSS background shown while it loads (placeholder over color, at the focal point); JPEG, WebP and AVIF only.
 */

/** Astro's "limited" screen widths; a site's closed set starts here. */
export const SCREEN_WIDTHS = [640, 750, 828, 1080, 1280, 1668, 2048, 2560];

/** The longest side Cloudflare Images encodes as AVIF (its documented limit); a larger size is offered as WebP. */
export const AVIF_MAX_EDGE = 1200;

/** The extension a size URL ends in, for each format the route writes; `jpg` is the share crop's (`shareImages`). */
const FORMAT_EXTENSIONS = /** @type {const} */ ({ avif: "avif", webp: "webp", jpeg: "jpg" });

/** The share crop (1200 by 630, a JPEG) and the Article image ratios, which `shareImages: true` adds to the closed sets. */
export const SHARE_IMAGE = /** @type {const} */ ({ width: 1200, ratio: "40x21", format: "jpeg" });
export const ARTICLE_IMAGE_RATIOS = /** @type {const} */ (["16x9", "4x3", "1x1"]);

const PLACEHOLDER = /^data:image\/(png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/]+={0,2}$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const GIF_PATH = /\.gif(?:$|[?#])/i;
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * The widths an image is offered at, by Astro's rules (full-width: every screen width; fixed: 1x and 2x; constrained:
 * 1x, 2x and every screen width up to 2x), never wider than the original.
 * @param {{ layout: "constrained" | "fixed" | "full-width", width?: number, originalWidth?: number, breakpoints?: number[] }} options
 */
export function imageWidths({ layout, width, originalWidth, breakpoints = SCREEN_WIDTHS }) {
  const smallerThanOriginal = (/** @type {number} */ w) => !originalWidth || w <= originalWidth;
  if (layout === "full-width") return breakpoints.filter(smallerThanOriginal);
  if (!width) return [];
  const doubleWidth = width * 2;
  const maxSize = originalWidth ? Math.min(doubleWidth, originalWidth) : doubleWidth;
  if (layout === "fixed")
    return originalWidth && width > originalWidth
      ? [originalWidth]
      : [...new Set([width, maxSize])];
  return [...new Set([width, doubleWidth, ...breakpoints])]
    .filter((w) => w <= maxSize)
    .sort((a, b) => a - b);
}

/** The `sizes` attribute for a layout, in CSS pixels.
 * @param {{ layout: "constrained" | "fixed" | "full-width", width?: number }} options
 */
export function imageSizes({ layout, width }) {
  if (layout === "full-width") return "100vw";
  if (!width) return undefined;
  return layout === "fixed" ? `${width}px` : `(min-width: ${width}px) ${width}px, 100vw`;
}

/**
 * @typedef {{ layout: "constrained" | "fixed" | "full-width", width?: number, sizes?: string }} ImageUse
 *   How a page uses one image: its layout and the CSS width it shows at (`sizes` overrides the computed one).
 * @typedef {{ src: string, width: number | null, height: number | null, focus?: string | null, version?: unknown, placeholder?: string | null, color?: string | null }} StoredImage
 *   One stored image: where the route serves it, its real size, its focal point, its version (`imageVersion`: the
 *   stored hash or updated time) and the placeholder and main color stored at upload (site-api's media row).
 */

/**
 * What `defineImages` returns: the page half and the route half over one closed set.
 * - `widths`: The closed width set, ascending.
 * - `url`: One size's URL; with no width, the original, versioned.
 * - `shareImage`: og:image: 1200 x 630 around the focal point, image/jpeg; null with no size or not a raster. Needs `shareImages`.
 * - `articleImages`: Article `image`: 16:9, 4:3 and 1:1 at 1200 wide, image/webp; [] with no size or not a raster. Needs `shareImages`.
 * - `respond`: The original for a bare request, one transformed size for `?w=` (a GIF's first frame for `still=1`); 400 for anything outside the closed sets, and for a still of anything but a GIF.
 * - `serve`: The /media route around `respond`: GET and HEAD only (405), the key from the path after `prefix` ("/media/"), `keyPrefix` put before it, refused (404) unless every segment is safe and it starts with `within`; `read(key)` reads (and rereads) it; `cacheControl` (default versionedCache()) is a string or a function of the file. Every answer, refusals too, carries UPLOAD_HEADERS.
 * @template {string} U
 * @typedef {{ widths: number[]; ratios: string[]; url( src: string, options: { width?: number; format?: ImageFormat | "jpeg"; ratio?: string; focus?: string | null; still?: boolean; version?: string | number | Date | null; }, ): string; attributes(image: StoredImage, use: U): ImageAttributes; shareImage(image: StoredImage): SizedImageUrl | null; articleImages(image: StoredImage): SizedImageUrl[]; respond( request: Request, options: { object: R2ObjectLike | null; images?: ImagesLike; cache?: Cache; cacheControl?: string; reread?: () => Promise<R2ObjectLike | null>; }, ): Promise<Response>; serve( request: Request, options: { read: (key: string) => Promise<R2ObjectLike | null>; images?: ImagesLike; cache?: Cache; prefix?: string; keyPrefix?: string; within?: string; cacheControl?: | string | ((file: { request: Request; url: URL; key: string; object: R2ObjectLike; }) => string | undefined | Promise<string | undefined>); }, ): Promise<Response>; }} Images
 */

/**
 * The image half and the route half of a site's responsive images, sharing one closed set of widths and crops.
 * `uses` names each way the site shows images (`{ content: { layout: "constrained", width: 704 } }`); the closed width
 * set is every width any use can ask for. A use's `ratio` is a crop around the file's focal point. `shareImages: true`
 * adds the share crop and the Article set.

 * @template {string} U
 * @param {{ uses: Record<U, ImageUse & { ratio?: string }>, breakpoints?: number[], quality?: number, shareImages?: boolean }} config
 */
export function defineImages({
  uses,
  breakpoints = SCREEN_WIDTHS,
  quality = IMAGE_QUALITY,
  shareImages = false,
}) {
  const names = /** @type {U[]} */ (Object.keys(uses));
  if (names.length === 0) throw new Error("defineImages: name at least one use.");
  if (!breakpoints.every((w) => Number.isInteger(w) && w > 0))
    throw new Error("defineImages: breakpoints are whole-pixel widths.");
  const widths = new Set();
  const ratios = new Set();
  for (const name of names) {
    const use = uses[name];
    if (
      use.layout !== "full-width" &&
      !(Number.isInteger(use.width) && /** @type {number} */ (use.width) > 0)
    ) {
      throw new Error(
        `defineImages: use "${name}" is ${use.layout} and needs a whole-pixel width.`,
      );
    }
    if (use.ratio !== undefined && !RATIO.test(use.ratio))
      throw new Error(`defineImages: use "${name}" has ratio "${use.ratio}"; write it as 16x9.`);
    if (use.ratio) ratios.add(use.ratio);
    for (const w of imageWidths({ layout: use.layout, width: use.width, breakpoints }))
      widths.add(w);
  }
  const formats = new Set(["avif", "webp"]);
  if (shareImages) {
    widths.add(SHARE_IMAGE.width);
    for (const r of [SHARE_IMAGE.ratio, ...ARTICLE_IMAGE_RATIOS]) ratios.add(r);
    formats.add(SHARE_IMAGE.format);
  }

  /**
   * The URL of one size: the path ends in the format's extension, `?w=` is the width, `r=` a crop, `fp=` the focal
   * point it is cut around, `still=1` an animation's first frame, `v=` the file's version. With no width it is the
   * original, versioned.
   * @param {string} src
   * @param {{ width?: number, format?: keyof typeof FORMAT_EXTENSIONS, ratio?: string, focus?: string | null, still?: boolean, version?: unknown }} options
   */
  function url(src, { width, format = "webp", ratio, focus, still = false, version }) {
    const at = src.indexOf("?");
    const [path, query] = at < 0 ? [src, ""] : [src.slice(0, at), src.slice(at + 1)];
    const params = new URLSearchParams(query);
    const v = imageVersion(version);
    if (v) params.set("v", v);
    if (width === undefined) return params.size ? `${path}?${params}` : path;
    params.set("w", String(width));
    if (ratio) {
      params.set("r", ratio);
      const fp = focusOf(focus);
      if (fp) params.set("fp", fp);
    }
    if (still) params.set("still", "1");
    return `${path}.${FORMAT_EXTENSIONS[format]}?${params}`;
  }

  /**
   * What a page writes for one image used one way: `src`, `srcset` and `sizes` for the `<img>`, `sources` for a
   * `<picture>`, and `width` and `height` (the crop's when the use has a ratio). An image with no known size, or not a
   * raster, gets no srcset: the original, unsized, is better than a guess.
   * @param {StoredImage} image
   * @param {U} useName
   */
  function attributes(image, useName) {
    const use = uses[useName];
    if (!use) throw new Error(`defineImages: no use named "${useName}".`);
    const plain = {
      src: image.src,
      srcset: undefined,
      sizes: undefined,
      sources: [],
      width: image.width ?? undefined,
      height: image.height ?? undefined,
      background: undefined,
    };
    if (!image.width || !image.height || !isRasterPath(image.src)) return plain;
    const offered = imageWidths({
      layout: use.layout,
      width: use.width,
      originalWidth: image.width,
      breakpoints,
    }).filter((w) => widths.has(w));
    if (offered.length === 0) return plain;
    const shape = use.ratio ? RATIO.exec(use.ratio) : null;
    const aspect = shape ? Number(shape[2]) / Number(shape[1]) : image.height / image.width;
    const shown =
      use.layout === "full-width"
        ? image.width
        : Math.min(/** @type {number} */ (use.width), image.width);
    // Over AVIF_MAX_EDGE the AVIF source names that size's WebP, so each URL holds the format it names.
    const formatAt = (/** @type {keyof typeof IMAGE_FORMATS} */ format, /** @type {number} */ w) =>
      format === "avif" && Math.max(w, Math.round(w * aspect)) > AVIF_MAX_EDGE ? "webp" : format;
    const srcsetOf = (/** @type {keyof typeof IMAGE_FORMATS} */ format, still = false) =>
      offered
        .map(
          (w) =>
            `${url(image.src, { width: w, format: formatAt(format, w), ratio: use.ratio, focus: image.focus, still, version: image.version })} ${w}w`,
        )
        .join(", ");
    const sources = GIF_PATH.test(image.src)
      ? [
          { type: IMAGE_FORMATS.avif, srcset: srcsetOf("avif", true), media: REDUCED_MOTION },
          { type: IMAGE_FORMATS.webp, srcset: srcsetOf("webp", true), media: REDUCED_MOTION },
          { type: IMAGE_FORMATS.webp, srcset: srcsetOf("webp") },
        ]
      : [
          { type: IMAGE_FORMATS.avif, srcset: srcsetOf("avif") },
          { type: IMAGE_FORMATS.webp, srcset: srcsetOf("webp") },
        ];
    return {
      src: url(image.src, {
        width: offered.find((w) => w >= shown) ?? offered[offered.length - 1],
        ratio: use.ratio,
        focus: image.focus,
        version: image.version,
      }),
      srcset: srcsetOf("webp"),
      sizes: use.sizes ?? imageSizes(use),
      sources,
      width: shown,
      height: Math.round(shown * aspect),
      background: placeholderBackground(image),
    };
  }

  /**
   * The share crop for og:image and twitter:image; null with no known size or no raster (the page uses a ./share-card).
   * @param {StoredImage} image
   */
  function shareImage(image) {
    if (!shareImages) throw new Error("defineImages: shareImage needs shareImages: true.");
    if (!image.width || !image.height || !isRasterPath(image.src)) return null;
    const { width, ratio, format } = SHARE_IMAGE;
    return {
      url: url(image.src, { width, ratio, format, focus: image.focus, version: image.version }),
      width,
      height: cropHeight(width, ratio),
      type: "image/jpeg",
    };
  }

  /**
   * The Article or BlogPosting `image` set (a GIF's first frame); empty with no known size or no raster.
   * @param {StoredImage} image
   */
  function articleImages(image) {
    if (!shareImages) throw new Error("defineImages: articleImages needs shareImages: true.");
    if (!image.width || !image.height || !isRasterPath(image.src)) return [];
    const width = SHARE_IMAGE.width;
    const still = GIF_PATH.test(image.src);
    return ARTICLE_IMAGE_RATIOS.map((ratio) => ({
      url: url(image.src, { width, ratio, focus: image.focus, still, version: image.version }),
      width,
      height: cropHeight(width, ratio),
      type: IMAGE_FORMATS.webp,
    }));
  }

  /**
   * The route: the original for a bare request, or one transformed size for `?w=`. It never writes to the bucket.
   * @param {Request} request
   * @param {{ object: R2ObjectLike | null, images?: ImagesLike, cache?: Cache, cacheControl?: string, reread?: () => Promise<R2ObjectLike | null> }} options
   */
  function respond(request, options) {
    return respondImage({ widths, ratios, formats, quality }, request, options);
  }

  /**
   * The site's /media route around `respond`: the method gate, the key from the path, the file read, its cache policy,
   * and every answer, refusals too, under UPLOAD_HEADERS so no file runs script.
   * @param {Request} request
   * @param {{ read: (key: string) => Promise<R2ObjectLike | null>, images?: ImagesLike, cache?: Cache, prefix?: string, keyPrefix?: string, within?: string, cacheControl?: string | ((file: { request: Request, url: URL, key: string, object: R2ObjectLike }) => string | undefined | Promise<string | undefined>) }} options
   */
  async function serve(
    request,
    {
      read,
      images,
      cache,
      prefix = "/media/",
      keyPrefix = "",
      within = "",
      cacheControl = versionedCache(),
    },
  ) {
    const guarded = (/** @type {Response} */ response) => applyHeaderSet(response, UPLOAD_HEADERS);
    if (request.method !== "GET" && request.method !== "HEAD")
      return guarded(textResponse("Method not allowed", 405, { allow: "GET, HEAD" }));
    const url = new URL(request.url);
    let key = null;
    // Each segment is decoded as keyOfAddress decodes it; a malformed escape is a 404.
    if (url.pathname.startsWith(prefix)) {
      try {
        const path = url.pathname.slice(prefix.length).split("/").map(decodeURIComponent).join("/");
        key = mediaKey(keyPrefix + originalKey(path, url), within);
      } catch {
        key = null;
      }
    }
    if (!key) return guarded(textResponse("Not found", 404));
    const object = await retryR2Read(() => read(key));
    const policy =
      object && typeof cacheControl === "function"
        ? await cacheControl({ request, url, key, object })
        : typeof cacheControl === "string"
          ? cacheControl
          : undefined;
    return guarded(
      await respond(request, {
        object,
        images,
        cache,
        ...(policy ? { cacheControl: policy } : {}),
        reread: () => read(key),
      }),
    );
  }

  return {
    widths: [...widths].sort((a, b) => a - b),
    ratios: [...ratios],
    url,
    attributes,
    shareImage,
    articleImages,
    respond,
    serve,
  };
}

/**
 * The CSS background an image shows while it loads: its stored placeholder over its main color, at its focal point.
 * Only for a JPEG, WebP or AVIF (a PNG or GIF is often clear, so the placeholder would show through). Values outside
 * site-api's contract (MediaPlaceholder, MediaColor) are dropped, so nothing else reaches the style.
 * @param {StoredImage} image
 */
function placeholderBackground({ src, placeholder, color, focus }) {
  if (!/\.(jpe?g|webp|avif)(?:$|[?#])/i.test(src)) return undefined;
  const picture =
    typeof placeholder === "string" && placeholder.length <= 2048 && PLACEHOLDER.test(placeholder)
      ? placeholder
      : null;
  const fill = typeof color === "string" && COLOR.test(color) ? color.toLowerCase() : null;
  if (!picture && !fill) return undefined;
  if (!picture) return /** @type {string} */ (fill);
  const [x, y] = (focusOf(focus) ?? "0.5x0.5")
    .split("x")
    .map((n) => `${Math.round(Number(n) * 100)}%`);
  return `${fill ? `${fill} ` : ""}url("${picture}") ${x} ${y}/cover no-repeat`;
}
