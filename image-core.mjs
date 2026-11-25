/**
 * The leaf the image halves share: the stored key an address names, a file's version and focal point, the cache a
 * /media address gets, and the raster tests. Nothing here imports the route or the page half.
 */

/** @import { AddressOptions } from "./image.mjs" */
import { mediaType } from "./http.mjs";

/** @import { R2ObjectLike } from "./image.mjs" */

/** Cloudflare's documented default; omitting it makes the binding write lossless WebP. */
export const IMAGE_QUALITY = 85;

/** The formats the route writes, in the order a `<picture>` offers them: the first a browser takes wins. */
export const IMAGE_FORMATS = /** @type {const} */ ({ avif: "image/avif", webp: "image/webp" });

/** The R2 custom-metadata field that holds a file's focal point, as "XxY" with X and Y from 0 to 1. */
export const FOCUS_METADATA = "focus";

const FOCUS = /^(0(?:\.\d{1,3})?|1(?:\.0{1,3})?)x(0(?:\.\d{1,3})?|1(?:\.0{1,3})?)$/;
export const RATIO = /^([1-9]\d{0,1})x([1-9]\d{0,1})$/;

/**
 * A file's version as a size URL writes it (`v=`), or null: the first 12 characters of a hex hash (site-api's sha256),
 * or a time (a Date, epoch milliseconds or an ISO string, such as the row's updated time) in base 36.
 * @param {unknown} value
 */
export function imageVersion(value) {
  if (typeof value === "string" && /^[0-9a-f]{12,}$/i.test(value))
    return value.slice(0, 12).toLowerCase();
  const time =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : typeof value === "string"
          ? Date.parse(value)
          : NaN;
  return Number.isFinite(time) && time > 0 ? Math.trunc(time).toString(36) : null;
}

/**
 * The stored key a size URL names: `photo.jpg` for `photo.jpg.webp?w=640`. A request with no `w`, or a key whose suffix
 * does not follow a raster extension (a URL from before suffixes, `photo.webp?w=640`), is the key as it is.
 * @param {string} key the path the route matched, such as React Router's `params["*"]`
 * @param {Request | URL | string} request
 */
export function originalKey(key, request) {
  const url = new URL(
    typeof request === "string" ? request : request instanceof URL ? request.href : request.url,
  );
  return url.searchParams.has("w") ? (suffixed(key)?.stored ?? key) : key;
}

/**
 * The format a path's last extension names, and the path without it, when what is left still ends in a raster
 * extension; else null.
 * @param {string} path
 */
export function suffixed(path) {
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
 */
export function focusOf(value) {
  if (typeof value !== "string") return null;
  const m = FOCUS.exec(value.trim());
  return m ? `${Number(m[1])}x${Number(m[2])}` : null;
}

/**
 * A focal point as CSS `object-position` ("37.5% 60%"), each axis rounded to a tenth of a percent; undefined when
 * `value` is not a focal point.
 * @param {unknown} value
 */
export function focalPosition(value) {
  const point = focusOf(value);
  if (!point) return undefined;
  return point
    .split("x")
    .map((n) => `${Math.round(Number(n) * 1000) / 10}%`)
    .join(" ");
}

/** The cache a stored file gets when its address carries the file's version. */
export const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

/**
 * The cache policy for a /media address: a page's addresses carry the file's version (`v`), so one with it is cached
 * for good; without it (an address a person copied), `plain`, so a replaced file shows through within it.
 * @param {{ plain?: string }} [options] `plain` defaults to a day
 * @returns {(file: { url: URL }) => string}
 */
export function versionedCache({ plain = "public, max-age=86400" } = {}) {
  return ({ url }) => (url.searchParams.has("v") ? IMMUTABLE_CACHE : plain);
}

/**
 * A file the Worker's static assets hold (public/), in the shape `respond` and `serve` read from R2, or null. The ASSETS
 * binding matches the pathname alone, so the host is a placeholder.
 * @param {{ fetch(request: Request): Promise<Response> }} assets the ASSETS binding
 * @param {string} key the file's path under public/
 * @returns {Promise<R2ObjectLike | null>}
 */
export async function assetsObject(assets, key) {
  const response = await assets.fetch(new Request(`https://assets.local/${key}`));
  if (!response.ok || !response.body) return null;
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  return {
    body: response.body,
    httpEtag: response.headers.get("etag") ?? `"${key}"`,
    httpMetadata: { contentType },
    writeHttpMetadata: (headers) => headers.set("content-type", contentType),
  };
}

const KEY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._ ()+,=@~-]*$/;

/**
 * A stored key from a /media path, or null: every segment non-empty, never "." or "..", starting with a letter or digit
 * with no backslash, percent sign or control character, and the key under `within` when given.
 * @param {string} path the path after the route's prefix
 * @param {string} [within] the prefix every served key has ("uploads/"), "" for any
 */
export function mediaKey(path, within = "") {
  const key = path.replace(/^\/+/, "");
  if (!key || !key.startsWith(within)) return null;
  return key.split("/").every((part) => KEY_SEGMENT.test(part) && part !== "." && part !== "..")
    ? key
    : null;
}

/**
 * The stored key an image address names, or null: `<prefix><path>` (default "/media/"), optionally after one of the
 * site's own `origins`, query and fragment cut, segments percent-decoded, a size's format suffix cut as the route cuts
 * it, `keyPrefix` put back, and the key checked by `mediaKey`. The inverse of the address a page writes.
 * @param {string} address
 * @param {AddressOptions} [options]
 */
export function keyOfAddress(
  address,
  { origins = [], prefix = "/media/", keyPrefix = "", within = "" } = {},
) {
  let path = address.trim();
  const origin = origins.find((o) => path.startsWith(`${o.replace(/\/+$/, "")}/`));
  if (origin) path = path.slice(origin.replace(/\/+$/, "").length);
  if (!path.startsWith(prefix)) return null;
  const [rest = "", query = ""] = path.slice(prefix.length).split("#")[0].split("?");
  // A size's address (`photo.jpg.webp?w=640`) names the original, as the route reads it (originalKey).
  const sized = new URLSearchParams(query).has("w") ? (suffixed(rest)?.stored ?? rest) : rest;
  try {
    return mediaKey(keyPrefix + sized.split("/").map(decodeURIComponent).join("/"), within);
  } catch {
    return null;
  }
}

/**
 * Every stored key a text names by address (markdown, HTML, srcset or JSON), trailing sentence punctuation cut, in the
 * order first named. Over-detection only keeps a file from being deleted; a key with a space or `)` is found only when
 * the address is encoded.
 * @param {string | null | undefined} text
 * @param {AddressOptions} [options]
 * @returns {Set<string>}
 */
export function keysAtAddresses(text, options = {}) {
  const keys = new Set();
  if (!text) return keys;
  const escape = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const origins = (options.origins ?? []).map((o) => escape(o.replace(/\/+$/, ""))).join("|");
  const address = new RegExp(
    `(?:^|[\\s"'\`(\\[=,>])((?:${origins ? `(?:${origins})` : ""})?${escape(options.prefix ?? "/media/")}[^\\s"'\`<>()\\[\\]\\\\]+)`,
    "g",
  );
  for (const m of text.matchAll(address)) {
    const key = keyOfAddress((m[1] ?? "").replace(/[.,;:!]+$/, ""), options);
    if (key) keys.add(key);
  }
  return keys;
}

/** The raster image types, and the paths that name one (a query or fragment may follow the extension). */
export const RASTER_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/gif",
]);
export const RASTER_PATH = /\.(png|jpe?g|webp|avif|gif)(?:$|[?#])/i;

/** @param {string} path */
export function isRasterPath(path) {
  return RASTER_PATH.test(path);
}

/** @param {string | null | undefined} type */
export function isRasterType(type) {
  return RASTER_TYPES.has(mediaType(type));
}

/** @param {number} width @param {string} ratio */
export function cropHeight(width, ratio) {
  const [, w, h] = /** @type {RegExpExecArray} */ (RATIO.exec(ratio));
  return Math.round((width * Number(h)) / Number(w));
}
