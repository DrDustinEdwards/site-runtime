/**
 * A file's version as a size URL writes it (`v=`), or null: the first 12 characters of a hex hash (site-api's sha256),
 * or a time (a Date, epoch milliseconds or an ISO string, such as the row's updated time) in base 36.
 * @param {unknown} value
 */
export function imageVersion(value: unknown): string | null;
/**
 * The stored key a size URL names: `photo.jpg` for `photo.jpg.webp?w=640`. A request with no `w`, or a key whose suffix
 * does not follow a raster extension (a URL from before suffixes, `photo.webp?w=640`), is the key as it is.
 * @param {string} key the path the route matched, such as React Router's `params["*"]`
 * @param {Request | URL | string} request
 */
export function originalKey(key: string, request: Request | URL | string): string;
/**
 * The format a path's last extension names, and the path without it, when what is left still ends in a raster
 * extension; else null.
 * @param {string} path
 */
export function suffixed(path: string): {
    stored: string;
    format: string;
} | null;
/**
 * A focal point as the URL and the binding write it, or null when `value` is not one.
 * @param {unknown} value
 */
export function focusOf(value: unknown): string | null;
/**
 * A focal point as CSS `object-position` ("37.5% 60%"), each axis rounded to a tenth of a percent; undefined when
 * `value` is not a focal point.
 * @param {unknown} value
 */
export function focalPosition(value: unknown): string | undefined;
/**
 * The cache policy for a /media address: a page's addresses carry the file's version (`v`), so one with it is cached
 * for good; without it (an address a person copied), `plain`, so a replaced file shows through within it.
 * @param {{ plain?: string }} [options] `plain` defaults to a day
 * @returns {(file: { url: URL }) => string}
 */
export function versionedCache({ plain }?: {
    plain?: string;
}): (file: {
    url: URL;
}) => string;
/**
 * A file the Worker's static assets hold (public/), in the shape `respond` and `serve` read from R2, or null. The ASSETS
 * binding matches the pathname alone, so the host is a placeholder.
 * @param {{ fetch(request: Request): Promise<Response> }} assets the ASSETS binding
 * @param {string} key the file's path under public/
 * @returns {Promise<R2ObjectLike | null>}
 */
export function assetsObject(assets: {
    fetch(request: Request): Promise<Response>;
}, key: string): Promise<R2ObjectLike | null>;
/**
 * A stored key from a /media path, or null: every segment non-empty, never "." or "..", starting with a letter or digit
 * with no backslash, percent sign or control character, and the key under `within` when given.
 * @param {string} path the path after the route's prefix
 * @param {string} [within] the prefix every served key has ("uploads/"), "" for any
 */
export function mediaKey(path: string, within?: string): string | null;
/**
 * The stored key an image address names, or null: `<prefix><path>` (default "/media/"), optionally after one of the
 * site's own `origins`, query and fragment cut, segments percent-decoded, a size's format suffix cut as the route cuts
 * it, `keyPrefix` put back, and the key checked by `mediaKey`. The inverse of the address a page writes.
 * @param {string} address
 * @param {{ origins?: string[], prefix?: string, keyPrefix?: string, within?: string }} [options]
 */
export function keyOfAddress(address: string, { origins, prefix, keyPrefix, within }?: {
    origins?: string[];
    prefix?: string;
    keyPrefix?: string;
    within?: string;
}): string | null;
/**
 * Every stored key a text names by address (markdown, HTML, srcset or JSON), trailing sentence punctuation cut, in the
 * order first named. Over-detection only keeps a file from being deleted; a key with a space or `)` is found only when
 * the address is encoded.
 * @param {string | null | undefined} text
 * @param {{ origins?: string[], prefix?: string, keyPrefix?: string, within?: string }} [options]
 */
export function keysAtAddresses(text: string | null | undefined, options?: {
    origins?: string[];
    prefix?: string;
    keyPrefix?: string;
    within?: string;
}): Set<any>;
/** @param {string} path */
export function isRasterPath(path: string): boolean;
/** @param {string | null | undefined} type */
export function isRasterType(type: string | null | undefined): boolean;
/** @param {number} width @param {string} ratio */
export function cropHeight(width: number, ratio: string): number;
/**
 * @typedef {{ body: ReadableStream, httpEtag: string, httpMetadata?: { contentType?: string }, customMetadata?: Record<string, string>, writeHttpMetadata(headers: Headers): void }} R2ObjectLike
 * @typedef {{ output(options: { format: string, quality?: number, anim?: boolean }): Promise<{ response(): Response }> }} ImagesOutput
 * @typedef {{ input(stream: ReadableStream): ImagesOutput & { transform(options: object): ImagesOutput } }} ImagesLike
 */
/** Cloudflare's documented default; omitting it makes the binding write lossless WebP. */
export const IMAGE_QUALITY: 85;
export namespace IMAGE_FORMATS {
    let avif: "image/avif";
    let webp: "image/webp";
}
/** The R2 custom-metadata field that holds a file's focal point, as "XxY" with X and Y from 0 to 1. */
export const FOCUS_METADATA: "focus";
export const RATIO: RegExp;
/** The cache a stored file gets when its address carries the file's version. */
export const IMMUTABLE_CACHE: "public, max-age=31536000, immutable";
/** The raster image types, and the paths that name one (a query or fragment may follow the extension). */
export const RASTER_TYPES: Set<string>;
export const RASTER_PATH: RegExp;
export type R2ObjectLike = {
    body: ReadableStream;
    httpEtag: string;
    httpMetadata?: {
        contentType?: string;
    };
    customMetadata?: Record<string, string>;
    writeHttpMetadata(headers: Headers): void;
};
export type ImagesOutput = {
    output(options: {
        format: string;
        quality?: number;
        anim?: boolean;
    }): Promise<{
        response(): Response;
    }>;
};
export type ImagesLike = {
    input(stream: ReadableStream): ImagesOutput & {
        transform(options: object): ImagesOutput;
    };
};
