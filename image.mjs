/**
 * Responsive images: the attributes a page writes for an image (srcset, sizes, width, height and AVIF and WebP
 * sources) and the route that serves each size from the one original in R2 through the Images binding. The two halves
 * come from one `defineImages` call, so the page never asks for a size or a crop the route would refuse.
 *
 * Moved here from dustinedwards.info's /media route (2026-10-29) so every site resizes the same way. What it learned:
 * - The binding, not `/cdn-cgi/image/`: the URL interface needs a customer zone and answers 404 (error 1042) on
 *   workers.dev.
 * - Every set is CLOSED. The binding bills each unique source and parameter set once a month (5,000 free), so an open
 *   width, crop or focal point lets any caller mint billed transforms. Format and quality are not counted, so AVIF and
 *   WebP of one size bill once.
 * - The format is in the URL, never negotiated from `Accept`: the edge cache is keyed by URL alone, and a negotiated
 *   body stored under `immutable` would reach every browser. The page offers both through `<picture>`.
 * - With no `quality` the binding writes lossless WebP, larger than a lossy original, so 85 (Cloudflare's default) is
 *   always passed.
 * - A stored SVG is script running as the site, so it is only ever served as an attachment, and every file it serves
 *   carries UPLOAD_HEADERS (./headers: nosniff and a sandboxed policy), so no file runs script (ASVS 5.4.1).
 * - A GIF's sizes stay animated: the binding keeps every frame unless told `anim: false`, and writes them as animated
 *   WebP. Cloudflare documents animation for WebP and GIF output, not AVIF, so a GIF is offered no AVIF. Its first frame,
 *   `still=1`, is offered under prefers-reduced-motion (WCAG 2.2.2), from the same closed widths.
 * - A size URL is `immutable` for a year, so the edge cache key carrying the original's etag is not enough: a browser
 *   holding the old size keeps it. The page's URL carries the file's version (`v=`, from its stored hash or updated
 *   time), so a replaced picture is a new URL. `v` is never in the edge cache key, so it mints no transform, and an old
 *   version's URL still answers, with the current picture.
 * - A size URL ends in its own format's extension (`photo.jpg.webp?w=640`), so a saved or indexed size is never a WebP
 *   named .jpg. `originalKey` gives the route the stored key back; a URL from before, with no such suffix, still answers.
 * - Cloudflare encodes AVIF only up to 1,200 px on a side and answers WebP above it ("Image dimension, AVIF: 1,200
 *   pixels", developers.cloudflare.com/images/get-started/limits/; "too large to be quickly encoded to AVIF ... fall back
 *   to WebP or JPEG", /images/optimization/features/#format). So the AVIF source names the WebP for a larger size, and an
 *   AVIF request the binding answered in another format is sent to that format's URL: no URL named .avif holds a WebP.
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

import { corpFor, UPLOAD_HEADERS } from "./headers.mjs";

/**
 * Astro's "limited" screen widths, the set it uses for images it generates ahead of time. A site's closed set starts
 * here; the layouts below add the requested width and twice it.
 */
export const SCREEN_WIDTHS = [640, 750, 828, 1080, 1280, 1668, 2048, 2560];

/** The longest side Cloudflare Images encodes as AVIF (its documented limit); a larger size is offered as WebP. */
export const AVIF_MAX_EDGE = 1200;

/** The formats the route writes, in the order a `<picture>` offers them: the first a browser takes wins. */
export const IMAGE_FORMATS = /** @type {const} */ ({ avif: "image/avif", webp: "image/webp" });

/** The extension a size URL ends in, for each format the route writes; `jpg` is the share crop's (`shareImages`). */
const FORMAT_EXTENSIONS = /** @type {const} */ ({ avif: "avif", webp: "webp", jpeg: "jpg" });

/**
 * The share crop (1200 by 630, 1.91:1, the Open Graph size) and the Article image set Google asks for (16:9, 4:3 and 1:1,
 * each at least 50,000 pixels), all at 1200 wide, which `shareImages: true` adds to a site's closed sets. The share crop
 * is a JPEG, the one format every link preview reads.
 */
export const SHARE_IMAGE = /** @type {const} */ ({ width: 1200, ratio: "40x21", format: "jpeg" });
export const ARTICLE_IMAGE_RATIOS = /** @type {const} */ (["16x9", "4x3", "1x1"]);

/** Cloudflare's documented default; omitting it makes the binding write lossless WebP. */
export const IMAGE_QUALITY = 85;

/** The R2 custom-metadata field that holds a file's focal point, as "XxY" with X and Y from 0 to 1. */
export const FOCUS_METADATA = "focus";

const FOCUS = /^(0(?:\.\d{1,3})?|1(?:\.0{1,3})?)x(0(?:\.\d{1,3})?|1(?:\.0{1,3})?)$/;
const RATIO = /^([1-9]\d{0,1})x([1-9]\d{0,1})$/;
const VERSION = /^[A-Za-z0-9_-]{1,40}$/;
const PLACEHOLDER = /^data:image\/(png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/]+={0,2}$/;
const COLOR = /^#[0-9a-f]{6}$/i;

/**
 * A file's version as a size URL writes it (`v=`), or null: the first 12 characters of a hex hash (site-api's sha256),
 * or a time (a Date, epoch milliseconds or an ISO string, such as the row's updated time) in base 36.
 * @param {unknown} value
 * @returns {string | null}
 */
export function imageVersion(value) {
  if (typeof value === "string" && /^[0-9a-f]{12,}$/i.test(value)) return value.slice(0, 12).toLowerCase();
  const time = value instanceof Date ? value.getTime() : typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(time) && time > 0 ? Math.trunc(time).toString(36) : null;
}

/**
 * The stored key a size URL names: `photo.jpg` for `photo.jpg.webp?w=640`. A request with no `w`, or a key whose suffix
 * does not follow a raster extension (a URL from before suffixes, `photo.webp?w=640`), is the key as it is.
 * @param {string} key the path the route matched, such as React Router's `params["*"]`
 * @param {Request | URL | string} request
 * @returns {string}
 */
export function originalKey(key, request) {
  const url = new URL(typeof request === "string" ? request : request instanceof URL ? request.href : request.url);
  return url.searchParams.has("w") ? (suffixed(key)?.stored ?? key) : key;
}

/**
 * The format a path's last extension names, and the path without it, when what is left still ends in a raster
 * extension; else null.
 * @param {string} path
 */
function suffixed(path) {
  const m = /\.(avif|webp|jpg)$/i.exec(path);
  if (!m) return null;
  const stored = path.slice(0, m.index);
  if (!isRasterPath(stored)) return null;
  const ext = m[1].toLowerCase();
  return { stored, format: ext === "jpg" ? "jpeg" : ext };
}

/**
 * A focal point as the URL and the binding write it, or null when `value` is not one.
 * @param {unknown} value
 * @returns {string | null}
 */
export function focusOf(value) {
  if (typeof value !== "string") return null;
  const m = FOCUS.exec(value.trim());
  return m ? `${Number(m[1])}x${Number(m[2])}` : null;
}

/**
 * The widths an image is offered at, by Astro's rules: full-width takes every screen width up to the original;
 * fixed takes 1x and 2x; constrained takes 1x, 2x and every screen width up to 2x. Never wider than the original.
 * @param {{ layout: "constrained" | "fixed" | "full-width", width?: number, originalWidth?: number, breakpoints?: number[] }} options
 * @returns {number[]}
 */
export function imageWidths({ layout, width, originalWidth, breakpoints = SCREEN_WIDTHS }) {
  const smallerThanOriginal = (/** @type {number} */ w) => !originalWidth || w <= originalWidth;
  if (layout === "full-width") return breakpoints.filter(smallerThanOriginal);
  if (!width) return [];
  const doubleWidth = width * 2;
  const maxSize = originalWidth ? Math.min(doubleWidth, originalWidth) : doubleWidth;
  if (layout === "fixed") return originalWidth && width > originalWidth ? [originalWidth] : [...new Set([width, maxSize])];
  return [...new Set([width, doubleWidth, ...breakpoints])].filter((w) => w <= maxSize).sort((a, b) => a - b);
}

/**
 * The `sizes` attribute for a layout, in CSS pixels (the browser applies the device pixel ratio itself).
 * @param {{ layout: "constrained" | "fixed" | "full-width", width?: number }} options
 * @returns {string | undefined}
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
 * The image half and the route half of a site's responsive images, sharing one closed set of widths and crops.
 *
 * `uses` names each way the site shows images (`{ content: { layout: "constrained", width: 704 } }`); the closed width
 * set is every width any use can ask for. `ratios` are the crops a use may ask for ("16x9"), cut around the file's
 * focal point, or the binding's own guess where it has none. `shareImages: true` adds the share crop and the Article set
 * (SHARE_IMAGE, ARTICLE_IMAGE_RATIOS) for `shareImage` and `articleImages`.
 *
 * @template {string} U
 * @param {{ uses: Record<U, ImageUse & { ratio?: string }>, breakpoints?: number[], quality?: number, shareImages?: boolean }} config
 */
export function defineImages({ uses, breakpoints = SCREEN_WIDTHS, quality = IMAGE_QUALITY, shareImages = false }) {
  const names = /** @type {U[]} */ (Object.keys(uses));
  if (names.length === 0) throw new Error("defineImages: name at least one use.");
  if (!breakpoints.every((w) => Number.isInteger(w) && w > 0)) throw new Error("defineImages: breakpoints are whole-pixel widths.");
  const widths = new Set();
  const ratios = new Set();
  for (const name of names) {
    const use = uses[name];
    if (use.layout !== "full-width" && !(Number.isInteger(use.width) && /** @type {number} */ (use.width) > 0)) {
      throw new Error(`defineImages: use "${name}" is ${use.layout} and needs a whole-pixel width.`);
    }
    if (use.ratio !== undefined && !RATIO.test(use.ratio)) throw new Error(`defineImages: use "${name}" has ratio "${use.ratio}"; write it as 16x9.`);
    if (use.ratio) ratios.add(use.ratio);
    for (const w of imageWidths({ layout: use.layout, width: use.width, breakpoints })) widths.add(w);
  }
  const formats = new Set(["avif", "webp"]);
  if (shareImages) {
    widths.add(SHARE_IMAGE.width);
    for (const r of [SHARE_IMAGE.ratio, ...ARTICLE_IMAGE_RATIOS]) ratios.add(r);
    formats.add(SHARE_IMAGE.format);
  }

  /**
   * The URL of one size: the path ends in the format's extension, `?w=` is the width, `r=` a crop and `fp=` the focal
   * point that crop is cut around (so a new focal point is a new URL, never a stale cached crop), `still=1` an
   * animation's first frame, and `v=` the file's version, so a replaced file is a new URL. With no width it is the
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
   * What a page writes for one image used one way: `src` (the WebP at the use's width, or the original), `srcset` and
   * `sizes` for the `<img>`, `sources` for a `<picture>` (AVIF then WebP), and `width` and `height` so nothing shifts
   * as it loads (the crop's when the use has a ratio). An image the site has no size for, or one that is not a raster,
   * gets no srcset: the original, unsized, is better than a guess. A GIF's sources are its first frame under
   * prefers-reduced-motion (AVIF then WebP), then the animated WebP.
   * @param {StoredImage} image
   * @param {U} useName
   */
  function attributes(image, useName) {
    const use = uses[useName];
    if (!use) throw new Error(`defineImages: no use named "${useName}".`);
    const plain = { src: image.src, srcset: undefined, sizes: undefined, sources: [], width: image.width ?? undefined, height: image.height ?? undefined, background: undefined };
    if (!image.width || !image.height || !isRasterPath(image.src)) return plain;
    const offered = imageWidths({ layout: use.layout, width: use.width, originalWidth: image.width, breakpoints }).filter((w) => widths.has(w));
    if (offered.length === 0) return plain;
    const shape = use.ratio ? RATIO.exec(use.ratio) : null;
    const aspect = shape ? Number(shape[2]) / Number(shape[1]) : image.height / image.width;
    const shown = use.layout === "full-width" ? image.width : Math.min(/** @type {number} */ (use.width), image.width);
    // An AVIF larger than Cloudflare encodes would come back WebP, so the AVIF source names that size's WebP: still
    // every width for a sharp picture on a dense screen, and each URL holds the format it names.
    const formatAt = (/** @type {keyof typeof IMAGE_FORMATS} */ format, /** @type {number} */ w) =>
      format === "avif" && Math.max(w, Math.round(w * aspect)) > AVIF_MAX_EDGE ? "webp" : format;
    const srcsetOf = (/** @type {keyof typeof IMAGE_FORMATS} */ format, still = false) =>
      offered.map((w) => `${url(image.src, { width: w, format: formatAt(format, w), ratio: use.ratio, focus: image.focus, still, version: image.version })} ${w}w`).join(", ");
    const sources = GIF_PATH.test(image.src)
      ? [
          { type: IMAGE_FORMATS.avif, srcset: srcsetOf("avif", true), media: REDUCED_MOTION },
          { type: IMAGE_FORMATS.webp, srcset: srcsetOf("webp", true), media: REDUCED_MOTION },
          { type: IMAGE_FORMATS.webp, srcset: srcsetOf("webp") },
        ]
      : [{ type: IMAGE_FORMATS.avif, srcset: srcsetOf("avif") }, { type: IMAGE_FORMATS.webp, srcset: srcsetOf("webp") }];
    return {
      src: url(image.src, { width: offered.find((w) => w >= shown) ?? offered[offered.length - 1], ratio: use.ratio, focus: image.focus, version: image.version }),
      srcset: srcsetOf("webp"),
      sizes: use.sizes ?? imageSizes(use),
      sources,
      width: shown,
      height: Math.round(shown * aspect),
      background: placeholderBackground(image),
    };
  }

  /**
   * The share crop for og:image and twitter:image: 1200 by 630 around the focal point, as a JPEG, with the tags' width,
   * height and type. Null for an image with no known size or that is not a raster (the page then uses a ./share-card).
   * @param {StoredImage} image
   */
  function shareImage(image) {
    if (!shareImages) throw new Error("defineImages: shareImage needs shareImages: true.");
    if (!image.width || !image.height || !isRasterPath(image.src)) return null;
    const { width, ratio, format } = SHARE_IMAGE;
    return { url: url(image.src, { width, ratio, format, focus: image.focus, version: image.version }), width, height: cropHeight(width, ratio), type: "image/jpeg" };
  }

  /**
   * The Article or BlogPosting `image` set: 16:9, 4:3 and 1:1 at 1200 wide around the focal point (a GIF's first frame),
   * as WebP, each with its size and type. Empty for an image with no known size or that is not a raster.
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
   * The route: the original for a bare request, or one transformed size for `?w=`. `object` is the R2 object the site
   * read for the key (null when it has none); the route never writes back to the bucket.
   * @param {Request} request
   * @param {{ object: R2ObjectLike | null, images?: ImagesLike, cache?: Cache, cacheControl?: string, reread?: () => Promise<R2ObjectLike | null> }} options
   * @returns {Promise<Response>}
   */
  async function respond(request, { object, images, cache, cacheControl = "public, max-age=31536000, immutable", reread }) {
    const query = new URL(request.url).searchParams;
    const requested = query.get("w");
    if (requested === null) return original(request, object, cacheControl);

    const width = Number(requested);
    const suffix = suffixed(new URL(request.url).pathname);
    const named = query.get("f");
    if (suffix && named !== null && named !== suffix.format) return new Response("Unsupported format", { status: 400 });
    const format = suffix?.format ?? named ?? "webp";
    const version = query.get("v");
    const ratio = query.get("r");
    const fp = query.get("fp");
    const still = query.get("still");
    // Closed sets: anything outside them is a 400, never a billed transform.
    if (!widths.has(width)) return new Response("Unsupported width", { status: 400 });
    if (!formats.has(format)) return new Response("Unsupported format", { status: 400 });
    if (version !== null && !VERSION.test(version)) return new Response("Unsupported version", { status: 400 });
    if (ratio !== null && !ratios.has(ratio)) return new Response("Unsupported crop", { status: 400 });
    if (fp !== null && (ratio === null || focusOf(fp) !== fp)) return new Response("Unsupported focal point", { status: 400 });
    if (still !== null && still !== "1") return new Response("Unsupported still", { status: 400 });
    if (!object) return new Response("Not found", { status: 404 });
    // The focal point in the URL must be the file's own, or any caller could mint crops.
    const stored = focusOf(object.customMetadata?.[FOCUS_METADATA]);
    if (fp !== null && fp !== stored) return new Response("Stale focal point", { status: 400 });
    // A still is a second billed transform of each size, so only a GIF has one.
    if (still !== null && mediaType(object.httpMetadata?.contentType) !== "image/gif") return new Response("Unsupported still", { status: 400 });
    if (!isRasterType(object.httpMetadata?.contentType)) return original(request, object, cacheControl);

    // TRAP: the edge cache is keyed by URL alone and has no purge, so every input to the body goes into the key, as
    // parameters never served or linked: the encoder's quality, and the original's etag, so a file replaced under the
    // same key (site-api's PUT /media/:id/file) is a new key for every size, never a stale one. The page's `v` is left
    // out: the etag already names the bytes, and a `v` in the key would let any caller mint a transform per value. The
    // format goes in as `f`, so a URL from before suffixes and its suffixed twin are one entry.
    const keyUrl = new URL(request.url);
    keyUrl.searchParams.delete("v");
    if (suffix) {
      keyUrl.pathname = suffix.stored;
      if (format !== "webp") keyUrl.searchParams.set("f", format);
    }
    keyUrl.searchParams.set("__q", String(quality));
    keyUrl.searchParams.set("__v", object.httpEtag);
    const cacheKey = new Request(keyUrl.toString(), { method: "GET" });
    const hit = cache ? await cache.match(cacheKey) : undefined;
    if (hit) return hit;

    if (!images) {
      // The binding is in each site's untracked wrangler.jsonc, so a checkout can lack it. Said in a header, or the
      // failure looks like a slow page.
      const headers = objectHeaders(object, cacheControl);
      headers.set("x-image", "unavailable-no-images-binding");
      return new Response(object.body, { headers });
    }

    const transform = ratio
      ? { width, height: cropHeight(width, ratio), fit: "cover", gravity: fp ?? "auto" }
      : { width, fit: "scale-down" };
    let response;
    try {
      // `anim` is left to the binding's default (every frame kept) unless the URL asks for the still.
      const output = { format: `image/${format}`, quality, ...(still ? { anim: false } : {}) };
      const result = await images.input(object.body).transform(transform).output(output);
      response = result.response();
    } catch (error) {
      console.error(JSON.stringify({ alert: "image-transform-failed", url: request.url, detail: error instanceof Error ? error.message : String(error) }));
      // The body above is spent, so the original is read again. Short-lived: this URL should hold the size once the
      // transform recovers.
      const again = reread ? await reread() : null;
      if (!again) return new Response("Image unavailable", { status: 503, headers: { "retry-after": "60" } });
      const headers = objectHeaders(again, "public, max-age=300");
      headers.set("x-image", "original-fallback");
      return new Response(again.body, { headers });
    }
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(UPLOAD_HEADERS)) headers.set(name, value);
    headers.set("cross-origin-resource-policy", "cross-origin");
    // Over Cloudflare's AVIF limit the binding writes WebP. A page from before AVIF_MAX_EDGE may still ask, so the
    // answer is the WebP's own URL, never a WebP named .avif. Permanent and cached like the size: the limit is fixed.
    if (format === "avif" && mediaType(headers.get("content-type")) === IMAGE_FORMATS.webp) {
      await response.body?.cancel();
      const twin = new URL(request.url);
      if (suffix) twin.pathname = twin.pathname.replace(/\.avif$/i, ".webp");
      else twin.searchParams.delete("f");
      const moved = new Response(null, { status: 301, headers: { location: `${twin.pathname}${twin.search}`, "cache-control": cacheControl, "cross-origin-resource-policy": "cross-origin", "x-image": `w=${width} avif-over-limit webp` } });
      if (cache) await cache.put(cacheKey, moved.clone());
      return moved;
    }
    headers.set("cache-control", cacheControl);
    headers.set("x-image", `w=${width}${ratio ? ` r=${ratio}` : ""}${still ? " still" : ""} ${format}`);
    const out = new Response(response.body, { headers });
    if (cache) await cache.put(cacheKey, out.clone());
    return out;
  }

  return { widths: [...widths].sort((a, b) => a - b), ratios: [...ratios], url, attributes, shareImage, articleImages, respond };
}

/**
 * What a `<picture>` for `attributes()` holds, as plain objects with JSX's prop names, for a page that renders JSX:
 * `sources` for the `<source>` elements and `img` for the `<img>`. `alt` is required: an image with nothing to say
 * passes "". Lazy by default; the page's first large image passes `priority`. An unset prop is undefined, which JSX
 * leaves out. With no `sources` the page writes the `<img>` alone.
 * @param {ReturnType<ReturnType<typeof defineImages>["attributes"]>} attrs
 * @param {{ alt: string, priority?: boolean, className?: string }} options
 */
export function pictureProps(attrs, { alt, priority = false, className }) {
  const style = attrs.background ? { background: attrs.background } : undefined;
  return {
    sources: attrs.sources.map((s) => ({ type: s.type, srcSet: s.srcset, sizes: attrs.sizes, media: s.media })),
    img: {
      src: attrs.src,
      srcSet: attrs.srcset,
      sizes: attrs.sizes,
      width: attrs.width,
      height: attrs.height,
      alt,
      className,
      loading: priority ? /** @type {const} */ ("eager") : /** @type {const} */ ("lazy"),
      fetchPriority: priority ? /** @type {const} */ ("high") : undefined,
      decoding: /** @type {const} */ ("async"),
      style,
    },
  };
}

/**
 * The preload for a page's LCP image (`./preload`): the first `<source>` any browser may take (AVIF, typed so a
 * browser without it skips the preload), its srcset and sizes, and fetchpriority=high. With no sources, the `<img>`'s.
 * @param {ReturnType<ReturnType<typeof defineImages>["attributes"]>} attrs
 */
export function imagePreload(attrs) {
  const source = attrs.sources.find((s) => !s.media);
  const srcset = source?.srcset ?? attrs.srcset;
  return {
    href: attrs.src,
    as: /** @type {const} */ ("image"),
    ...(source ? { type: source.type } : {}),
    ...(srcset ? { imageSrcSet: srcset, ...(attrs.sizes ? { imageSizes: attrs.sizes } : {}) } : {}),
    fetchPriority: /** @type {const} */ ("high"),
  };
}

/** The HTML attribute for each JSX prop `pictureProps` names differently. */
const HTML_NAMES = /** @type {Record<string, string>} */ ({ srcSet: "srcset", className: "class", fetchPriority: "fetchpriority" });

/**
 * `<picture>` markup for `attributes()`, for a page that writes HTML as a string: `pictureProps` written out, so the
 * two never differ.
 * @param {ReturnType<ReturnType<typeof defineImages>["attributes"]>} attrs
 * @param {{ alt: string, priority?: boolean, className?: string }} options
 * @param {(value: string) => string} escape the site's HTML attribute escape (`escapeHtml` from ./html)
 */
export function pictureHtml(attrs, options, escape) {
  const { sources, img } = pictureProps(attrs, options);
  const tag = (/** @type {string} */ name, /** @type {Record<string, unknown>} */ props) =>
    `<${name}${Object.entries(props)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([prop, value]) => ` ${HTML_NAMES[prop] ?? prop}="${escape(prop === "style" ? `background:${/** @type {{ background: string }} */ (value).background}` : String(value))}"`)
      .join("")}>`;
  if (sources.length === 0) return tag("img", img);
  return `<picture>${sources.map((s) => tag("source", s)).join("")}${tag("img", img)}</picture>`;
}

const EDIT_FORMATS = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

/**
 * One picture edited through the Images binding: turned, mirrored or shrunk, and encoded as `format`. For the writes a
 * site makes (a turn or mirror its editor asks for, an upload shrunk to a longest edge or turned from HEIC into JPEG,
 * a small copy to show a model),
 * not for serving sizes: `respond` does that, from a closed set. Each call is a billed transform, so a caller edits only
 * what a person asked for.
 *
 * Cloudflare applies `flip` before `rotate`, and turns clockwise. `maxEdge` fits the picture inside a square of that
 * side and never enlarges it. A format alone re-encodes the picture as it is (HEIC to JPEG on upload). Quality 85 unless
 * said: with none the binding writes lossless WebP. Options outside these throw before the binding is called, so a bad
 * request is never billed.
 * @param {ImagesLike} images the Images binding
 * @param {ReadableStream | ArrayBuffer | ArrayBufferView} input the picture's bytes
 * @param {{ rotate?: 90 | 180 | 270, flip?: "h" | "v" | "hv", maxEdge?: number, format: "image/jpeg" | "image/png" | "image/webp" | "image/avif", quality?: number }} options
 * @returns {Promise<Response>} the binding's response: the new bytes, with their content type
 */
export async function editImage(images, input, { rotate, flip, maxEdge, format, quality = IMAGE_QUALITY }) {
  if (rotate !== undefined && rotate !== 90 && rotate !== 180 && rotate !== 270) throw new Error(`editImage: rotate is 90, 180 or 270, not ${rotate}.`);
  if (flip !== undefined && flip !== "h" && flip !== "v" && flip !== "hv") throw new Error(`editImage: flip is "h", "v" or "hv", not ${flip}.`);
  if (maxEdge !== undefined && !(Number.isInteger(maxEdge) && maxEdge > 0)) throw new Error(`editImage: maxEdge is a whole-pixel length, not ${maxEdge}.`);
  if (!EDIT_FORMATS.has(format)) throw new Error(`editImage: format is one of ${[...EDIT_FORMATS].join(", ")}, not ${format}.`);
  if (!(Number.isInteger(quality) && quality >= 1 && quality <= 100)) throw new Error(`editImage: quality is 1 to 100, not ${quality}.`);
  /** @type {Record<string, unknown>} */
  const transform = {};
  if (flip) transform.flip = flip;
  if (rotate) transform.rotate = rotate;
  if (maxEdge) Object.assign(transform, { width: maxEdge, height: maxEdge, fit: "scale-down" });
  // A Response reads any buffer or view as exactly its own bytes, never the larger allocation a view may sit in.
  const stream = input instanceof ReadableStream ? input : /** @type {ReadableStream} */ (new Response(/** @type {BodyInit} */ (input)).body);
  // A re-encode alone goes straight to output: the binding takes `.output()` on its input, with no transform.
  const source = images.input(stream);
  const result = await (Object.keys(transform).length ? source.transform(transform) : source).output({ format, quality });
  return result.response();
}

/**
 * @typedef {{ body: ReadableStream, httpEtag: string, httpMetadata?: { contentType?: string }, customMetadata?: Record<string, string>, writeHttpMetadata(headers: Headers): void }} R2ObjectLike
 * @typedef {{ output(options: { format: string, quality?: number, anim?: boolean }): Promise<{ response(): Response }> }} ImagesOutput
 * @typedef {{ input(stream: ReadableStream): ImagesOutput & { transform(options: object): ImagesOutput } }} ImagesLike
 */

const RASTER_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/avif", "image/gif"]);
const RASTER_PATH = /\.(png|jpe?g|webp|avif|gif)(?:$|[?#])/i;
const GIF_PATH = /\.gif(?:$|[?#])/i;
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** @param {number} width @param {string} ratio */
function cropHeight(width, ratio) {
  const [, w, h] = /** @type {RegExpExecArray} */ (RATIO.exec(ratio));
  return Math.round((width * Number(h)) / Number(w));
}

/**
 * The CSS background an image shows while it loads: its stored placeholder over its main color, placed at its focal
 * point and covering the box, so the loaded picture paints over it with no shift and no script. Only for a JPEG, WebP
 * or AVIF: a PNG or GIF is often clear in places, where the placeholder would stay visible behind it. Values outside
 * site-api's contract (MediaPlaceholder, MediaColor) are dropped, so nothing else reaches the style.
 * @param {StoredImage} image
 * @returns {string | undefined}
 */
function placeholderBackground({ src, placeholder, color, focus }) {
  if (!/\.(jpe?g|webp|avif)(?:$|[?#])/i.test(src)) return undefined;
  const picture = typeof placeholder === "string" && placeholder.length <= 2048 && PLACEHOLDER.test(placeholder) ? placeholder : null;
  const fill = typeof color === "string" && COLOR.test(color) ? color.toLowerCase() : null;
  if (!picture && !fill) return undefined;
  if (!picture) return /** @type {string} */ (fill);
  const [x, y] = (focusOf(focus) ?? "0.5x0.5").split("x").map((n) => `${Math.round(Number(n) * 100)}%`);
  return `${fill ? `${fill} ` : ""}url("${picture}") ${x} ${y}/cover no-repeat`;
}

/** @param {string} path */
function isRasterPath(path) {
  return RASTER_PATH.test(path);
}

/** @param {string | undefined} type */
function mediaType(type) {
  return (type ?? "").split(";")[0].trim().toLowerCase();
}

/** @param {string | undefined} type */
function isRasterType(type) {
  return RASTER_TYPES.has(mediaType(type));
}

/**
 * @param {R2ObjectLike} object
 * @param {string} cacheControl
 */
function objectHeaders(object, cacheControl) {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", cacheControl);
  for (const [name, value] of Object.entries(UPLOAD_HEADERS)) headers.set(name, value);
  // A picture is shown by other origins (a link preview, a feed reader); anything else stays same-origin.
  headers.set("cross-origin-resource-policy", corpFor(headers.get("content-type")));
  // An SVG served inline from the site's own origin is script running as the site. Keyed on the stored type, so a file
  // renamed to .png is caught.
  if ((headers.get("content-type") ?? "").toLowerCase().startsWith("image/svg+xml")) headers.set("content-disposition", "attachment");
  return headers;
}

/**
 * @param {Request} request
 * @param {R2ObjectLike | null} object
 * @param {string} cacheControl
 */
function original(request, object, cacheControl) {
  if (!object) return new Response("Not found", { status: 404 });
  if (request.headers.get("if-none-match") === object.httpEtag) return new Response(null, { status: 304, headers: { etag: object.httpEtag } });
  return new Response(object.body, { headers: objectHeaders(object, cacheControl) });
}
