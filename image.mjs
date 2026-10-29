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
 * - A stored SVG is script running as the site, so it is only ever served as an attachment.
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

/**
 * Astro's "limited" screen widths, the set it uses for images it generates ahead of time. A site's closed set starts
 * here; the layouts below add the requested width and twice it.
 */
export const SCREEN_WIDTHS = [640, 750, 828, 1080, 1280, 1668, 2048, 2560];

/** The formats the route writes, in the order a `<picture>` offers them: the first a browser takes wins. */
export const IMAGE_FORMATS = /** @type {const} */ ({ avif: "image/avif", webp: "image/webp" });

/** Cloudflare's documented default; omitting it makes the binding write lossless WebP. */
export const IMAGE_QUALITY = 85;

/** The R2 custom-metadata field that holds a file's focal point, as "XxY" with X and Y from 0 to 1. */
export const FOCUS_METADATA = "focus";

const FOCUS = /^(0(?:\.\d{1,3})?|1(?:\.0{1,3})?)x(0(?:\.\d{1,3})?|1(?:\.0{1,3})?)$/;
const RATIO = /^([1-9]\d{0,1})x([1-9]\d{0,1})$/;

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
 * @typedef {{ src: string, width: number | null, height: number | null, focus?: string | null }} StoredImage
 *   One stored image: where the route serves it, its real size and its focal point.
 */

/**
 * The image half and the route half of a site's responsive images, sharing one closed set of widths and crops.
 *
 * `uses` names each way the site shows images (`{ content: { layout: "constrained", width: 704 } }`); the closed width
 * set is every width any use can ask for. `ratios` are the crops a use may ask for ("16x9"), cut around the file's
 * focal point, or the binding's own guess where it has none.
 *
 * @template {string} U
 * @param {{ uses: Record<U, ImageUse & { ratio?: string }>, breakpoints?: number[], quality?: number }} config
 */
export function defineImages({ uses, breakpoints = SCREEN_WIDTHS, quality = IMAGE_QUALITY }) {
  const names = /** @type {U[]} */ (Object.keys(uses));
  if (names.length === 0) throw new Error("defineImages: name at least one use.");
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

  /**
   * The URL of one size: `?w=` alone is a WebP at that width, `f=avif` asks for AVIF, `r=` a crop and `fp=` the focal
   * point that crop is cut around (so a new focal point is a new URL, never a stale cached crop).
   * @param {string} src
   * @param {{ width: number, format?: keyof typeof IMAGE_FORMATS, ratio?: string, focus?: string | null }} options
   */
  function url(src, { width, format = "webp", ratio, focus }) {
    const params = new URLSearchParams({ w: String(width) });
    if (format !== "webp") params.set("f", format);
    if (ratio) {
      params.set("r", ratio);
      const fp = focusOf(focus);
      if (fp) params.set("fp", fp);
    }
    return `${src}${src.includes("?") ? "&" : "?"}${params}`;
  }

  /**
   * What a page writes for one image used one way: `src` (the WebP at the use's width, or the original), `srcset` and
   * `sizes` for the `<img>`, `sources` for a `<picture>` (AVIF then WebP), and `width` and `height` so nothing shifts
   * as it loads (the crop's when the use has a ratio). An image the site has no size for, or one that is not a raster,
   * gets no srcset: the original, unsized, is better than a guess.
   * @param {StoredImage} image
   * @param {U} useName
   */
  function attributes(image, useName) {
    const use = uses[useName];
    if (!use) throw new Error(`defineImages: no use named "${useName}".`);
    const plain = { src: image.src, srcset: undefined, sizes: undefined, sources: [], width: image.width ?? undefined, height: image.height ?? undefined };
    if (!image.width || !image.height || !isRasterPath(image.src)) return plain;
    const offered = imageWidths({ layout: use.layout, width: use.width, originalWidth: image.width, breakpoints }).filter((w) => widths.has(w));
    if (offered.length === 0) return plain;
    const shape = use.ratio ? RATIO.exec(use.ratio) : null;
    const aspect = shape ? Number(shape[2]) / Number(shape[1]) : image.height / image.width;
    const shown = use.layout === "full-width" ? image.width : Math.min(/** @type {number} */ (use.width), image.width);
    const srcsetOf = (/** @type {keyof typeof IMAGE_FORMATS} */ format) =>
      offered.map((w) => `${url(image.src, { width: w, format, ratio: use.ratio, focus: image.focus })} ${w}w`).join(", ");
    return {
      src: url(image.src, { width: offered.find((w) => w >= shown) ?? offered[offered.length - 1], ratio: use.ratio, focus: image.focus }),
      srcset: srcsetOf("webp"),
      sizes: use.sizes ?? imageSizes(use),
      sources: [{ type: IMAGE_FORMATS.avif, srcset: srcsetOf("avif") }, { type: IMAGE_FORMATS.webp, srcset: srcsetOf("webp") }],
      width: shown,
      height: Math.round(shown * aspect),
    };
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
    const format = query.get("f") ?? "webp";
    const ratio = query.get("r");
    const fp = query.get("fp");
    // Closed sets: anything outside them is a 400, never a billed transform.
    if (!widths.has(width)) return new Response("Unsupported width", { status: 400 });
    if (!(format in IMAGE_FORMATS)) return new Response("Unsupported format", { status: 400 });
    if (ratio !== null && !ratios.has(ratio)) return new Response("Unsupported crop", { status: 400 });
    if (fp !== null && (ratio === null || focusOf(fp) !== fp)) return new Response("Unsupported focal point", { status: 400 });
    if (!object) return new Response("Not found", { status: 404 });
    // The focal point in the URL must be the file's own, or any caller could mint crops.
    const stored = focusOf(object.customMetadata?.[FOCUS_METADATA]);
    if (fp !== null && fp !== stored) return new Response("Stale focal point", { status: 400 });
    if (!isRasterType(object.httpMetadata?.contentType)) return original(request, object, cacheControl);

    // TRAP: the edge cache is keyed by URL alone and has no purge, so every input to the body goes into the key,
    // the encoder's quality included, as a parameter never served or linked.
    const keyUrl = new URL(request.url);
    keyUrl.searchParams.set("__q", String(quality));
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

    const shape = ratio ? RATIO.exec(ratio) : null;
    const transform = shape
      ? { width, height: Math.round((width * Number(shape[2])) / Number(shape[1])), fit: "cover", gravity: fp ?? "auto" }
      : { width, fit: "scale-down" };
    let response;
    try {
      const result = await images.input(object.body).transform(transform).output({ format: IMAGE_FORMATS[/** @type {keyof typeof IMAGE_FORMATS} */ (format)], quality });
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
    headers.set("cache-control", cacheControl);
    headers.set("x-image", `w=${width}${ratio ? ` r=${ratio}` : ""} ${format}`);
    const out = new Response(response.body, { headers });
    if (cache) await cache.put(cacheKey, out.clone());
    return out;
  }

  return { widths: [...widths].sort((a, b) => a - b), ratios: [...ratios], url, attributes, respond };
}

/**
 * `<picture>` markup for `attributes()`, for a page that writes HTML as a string. `alt` is required: an image with
 * nothing to say passes "". Lazy by default; the page's first large image passes `priority`.
 * @param {ReturnType<ReturnType<typeof defineImages>["attributes"]>} attrs
 * @param {{ alt: string, priority?: boolean, className?: string }} options
 * @param {(value: string) => string} escape the site's HTML attribute escape (`escapeHtml` from ./html)
 */
export function pictureHtml(attrs, { alt, priority = false, className }, escape) {
  const a = (/** @type {string} */ name, /** @type {unknown} */ value) => (value === undefined || value === null ? "" : ` ${name}="${escape(String(value))}"`);
  const loading = priority ? `${a("loading", "eager")}${a("fetchpriority", "high")}` : a("loading", "lazy");
  const img = `<img${a("src", attrs.src)}${a("srcset", attrs.srcset)}${a("sizes", attrs.sizes)}${a("width", attrs.width)}${a("height", attrs.height)}${a("alt", alt)}${a("class", className)}${loading}${a("decoding", "async")}>`;
  if (attrs.sources.length === 0) return img;
  const sources = attrs.sources.map((s) => `<source${a("type", s.type)}${a("srcset", s.srcset)}${a("sizes", attrs.sizes)}>`).join("");
  return `<picture>${sources}${img}</picture>`;
}

/**
 * @typedef {{ body: ReadableStream, httpEtag: string, httpMetadata?: { contentType?: string }, customMetadata?: Record<string, string>, writeHttpMetadata(headers: Headers): void }} R2ObjectLike
 * @typedef {{ input(stream: ReadableStream): { transform(options: object): { output(options: { format: string, quality?: number }): Promise<{ response(): Response }> } } }} ImagesLike
 */

const RASTER_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/avif", "image/gif"]);
const RASTER_PATH = /\.(png|jpe?g|webp|avif|gif)(?:$|[?#])/i;

/** @param {string} path */
function isRasterPath(path) {
  return RASTER_PATH.test(path);
}

/** @param {string | undefined} type */
function isRasterType(type) {
  return RASTER_TYPES.has((type ?? "").split(";")[0].trim().toLowerCase());
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
  // An SVG served inline from the site's own origin is script running as the site, and one sniffed back to SVG would
  // defeat the disposition. Keyed on the stored type, so a file renamed to .png is caught.
  if ((headers.get("content-type") ?? "").toLowerCase().startsWith("image/svg+xml")) {
    headers.set("content-disposition", "attachment");
    headers.set("x-content-type-options", "nosniff");
  }
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
