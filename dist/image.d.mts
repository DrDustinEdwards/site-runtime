/**
 * A file's version as a size URL writes it (`v=`), or null: the first 12 characters of a hex hash (site-api's sha256),
 * or a time (a Date, epoch milliseconds or an ISO string, such as the row's updated time) in base 36.
 * @param {unknown} value
 * @returns {string | null}
 */
export function imageVersion(value: unknown): string | null;
/**
 * The stored key a size URL names: `photo.jpg` for `photo.jpg.webp?w=640`. A request with no `w`, or a key whose suffix
 * does not follow a raster extension (a URL from before suffixes, `photo.webp?w=640`), is the key as it is.
 * @param {string} key the path the route matched, such as React Router's `params["*"]`
 * @param {Request | URL | string} request
 * @returns {string}
 */
export function originalKey(key: string, request: Request | URL | string): string;
/**
 * A focal point as the URL and the binding write it, or null when `value` is not one.
 * @param {unknown} value
 * @returns {string | null}
 */
export function focusOf(value: unknown): string | null;
/**
 * A focal point as CSS `object-position` ("37.5% 60%"), each axis rounded to a tenth of a percent; undefined when
 * `value` is not a focal point.
 * @param {unknown} value
 * @returns {string | undefined}
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
 * @returns {string | null}
 */
export function mediaKey(path: string, within?: string): string | null;
/**
 * The stored key an image address names, or null: `<prefix><path>` (default "/media/"), optionally after one of the
 * site's own `origins`, query and fragment cut, segments percent-decoded, a size's format suffix cut as the route cuts
 * it, `keyPrefix` put back, and the key checked by `mediaKey`. The inverse of the address a page writes.
 * @param {string} address
 * @param {{ origins?: string[], prefix?: string, keyPrefix?: string, within?: string }} [options]
 * @returns {string | null}
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
 * @returns {Set<string>}
 */
export function keysAtAddresses(text: string | null | undefined, options?: {
    origins?: string[];
    prefix?: string;
    keyPrefix?: string;
    within?: string;
}): Set<string>;
/**
 * The widths an image is offered at, by Astro's rules (full-width: every screen width; fixed: 1x and 2x; constrained:
 * 1x, 2x and every screen width up to 2x), never wider than the original.
 * @param {{ layout: "constrained" | "fixed" | "full-width", width?: number, originalWidth?: number, breakpoints?: number[] }} options
 * @returns {number[]}
 */
export function imageWidths({ layout, width, originalWidth, breakpoints }: {
    layout: "constrained" | "fixed" | "full-width";
    width?: number;
    originalWidth?: number;
    breakpoints?: number[];
}): number[];
/** The `sizes` attribute for a layout, in CSS pixels.
 * @param {{ layout: "constrained" | "fixed" | "full-width", width?: number }} options
 * @returns {string | undefined}
 */
export function imageSizes({ layout, width }: {
    layout: "constrained" | "fixed" | "full-width";
    width?: number;
}): string | undefined;
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
 * @returns {Images<U>}
 */
export function defineImages<U extends string>({ uses, breakpoints, quality, shareImages, }: {
    uses: Record<U, ImageUse & {
        ratio?: string;
    }>;
    breakpoints?: number[];
    quality?: number;
    shareImages?: boolean;
}): Images<U>;
/**
 * What a `<picture>` for `attributes()` holds, as plain objects with JSX's prop names: `sources` for the `<source>`
 * elements and `img` for the `<img>` (alone when there are no sources). `alt` is required ("" for none). Lazy by
 * default; the page's first large image passes `priority`. `focus` sets the `<img>`'s `objectPosition`.
 * @param {ImageAttributes} attrs
 * @param {{ alt: string, priority?: boolean, className?: string, focus?: unknown }} options
 */
export function pictureProps(attrs: ImageAttributes, { alt, priority, className, focus }: {
    alt: string;
    priority?: boolean;
    className?: string;
    focus?: unknown;
}): {
    sources: {
        type: string;
        srcSet: string;
        sizes: string | undefined;
        media: string | undefined;
    }[];
    img: {
        src: string;
        srcSet: string | undefined;
        sizes: string | undefined;
        width: number | undefined;
        height: number | undefined;
        alt: string;
        className: string | undefined;
        loading: "eager" | "lazy";
        fetchPriority: "high" | undefined;
        decoding: "async";
        style: {
            objectPosition?: string | undefined;
            background?: string | undefined;
        } | undefined;
    };
};
/**
 * The preload for a page's LCP image (`./preload`): the first unconditional `<source>` (typed), else the `<img>`'s.
 * @param {ImageAttributes} attrs
 */
export function imagePreload(attrs: ImageAttributes): {
    fetchPriority: "high";
    imageSizes?: string | undefined;
    imageSrcSet?: string | undefined;
    type?: string | undefined;
    href: string;
    as: "image";
};
/**
 * `<picture>` markup for `attributes()`: `pictureProps` written out as a string.
 * @param {ImageAttributes} attrs
 * @param {{ alt: string, priority?: boolean, className?: string }} options
 * @param {(value: string) => string} escape the site's HTML attribute escape (`escapeHtml` from ./html)
 */
export function pictureHtml(attrs: ImageAttributes, options: {
    alt: string;
    priority?: boolean;
    className?: string;
}, escape: (value: string) => string): string;
/**
 * One picture edited through the Images binding: turned, mirrored or shrunk, and encoded as `format`. For a site's own
 * writes, not for serving sizes (`respond` does that, from a closed set). Each call is a billed transform.
 * Cloudflare applies `flip` before `rotate`, and turns clockwise. `maxEdge` fits the picture inside a square of that
 * side and never enlarges it. A format alone re-encodes. Options outside these throw before the binding is called.
 * @param {ImagesLike} images the Images binding
 * @param {ReadableStream | ArrayBuffer | ArrayBufferView} input the picture's bytes
 * @param {{ rotate?: 90 | 180 | 270, flip?: "h" | "v" | "hv", maxEdge?: number, format: "image/jpeg" | "image/png" | "image/webp" | "image/avif", quality?: number }} options
 * @returns {Promise<Response>} the binding's response: the new bytes, with their content type
 */
export function editImage(images: ImagesLike, input: ReadableStream | ArrayBuffer | ArrayBufferView, { rotate, flip, maxEdge, format, quality }: {
    rotate?: 90 | 180 | 270;
    flip?: "h" | "v" | "hv";
    maxEdge?: number;
    format: "image/jpeg" | "image/png" | "image/webp" | "image/avif";
    quality?: number;
}): Promise<Response>;
/** @typedef {"constrained" | "fixed" | "full-width"} ImageLayout */
/** @typedef {"avif" | "webp"} ImageFormat */
/**
 * Where a site's addresses for stored files live: its own origins, the route's prefix, keyPrefix and within.
 * @typedef {object} AddressOptions
 * @property {string[]} [origins] The site's own origins ("https://example.com"); an absolute address on any other host names no file.
 * @property {string} [prefix] The route's path prefix. Default "/media/".
 * @property {string} [keyPrefix] Put in front of the path to make the stored key, as the route's `keyPrefix`.
 * @property {string} [within] The prefix every stored key has, as the route's `within`.
 */
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
/**
 * @typedef {object} PictureProps
 * @property {Array<{ type: string; srcSet: string; sizes: string | undefined; media: string | undefined; }>} sources One `<source>` each; empty when the page writes the `<img>` alone.
 * @property {{ src: string; srcSet: string | undefined; sizes: string | undefined; width: number | undefined; height: number | undefined; alt: string; className: string | undefined; loading: "eager" | "lazy"; fetchPriority: "high" | undefined; decoding: "async"; style: { background?: string; objectPosition?: string } | undefined; }} img
 */
/** @typedef {"image/jpeg" | "image/png" | "image/webp" | "image/avif"} EditFormat */
/** Astro's "limited" screen widths; a site's closed set starts here. */
export const SCREEN_WIDTHS: number[];
/** The longest side Cloudflare Images encodes as AVIF (its documented limit); a larger size is offered as WebP. */
export const AVIF_MAX_EDGE: 1200;
export namespace IMAGE_FORMATS {
    let avif: "image/avif";
    let webp: "image/webp";
}
export namespace SHARE_IMAGE {
    let width: 1200;
    let ratio: "40x21";
    let format: "jpeg";
}
export const ARTICLE_IMAGE_RATIOS: readonly ["16x9", "4x3", "1x1"];
/** Cloudflare's documented default; omitting it makes the binding write lossless WebP. */
export const IMAGE_QUALITY: 85;
/** The R2 custom-metadata field that holds a file's focal point, as "XxY" with X and Y from 0 to 1. */
export const FOCUS_METADATA: "focus";
/** The cache a stored file gets when its address carries the file's version. */
export const IMMUTABLE_CACHE: "public, max-age=31536000, immutable";
/**
 * @typedef {{ body: ReadableStream, httpEtag: string, httpMetadata?: { contentType?: string }, customMetadata?: Record<string, string>, writeHttpMetadata(headers: Headers): void }} R2ObjectLike
 * @typedef {{ output(options: { format: string, quality?: number, anim?: boolean }): Promise<{ response(): Response }> }} ImagesOutput
 * @typedef {{ input(stream: ReadableStream): ImagesOutput & { transform(options: object): ImagesOutput } }} ImagesLike
 */
/** The raster image types, and the paths that name one (a query or fragment may follow the extension). */
export const RASTER_TYPES: Set<string>;
export const RASTER_PATH: RegExp;
/**
 * How a page uses one image: its layout and the CSS width it shows at (`sizes` overrides the computed one).
 */
export type ImageUse = {
    layout: "constrained" | "fixed" | "full-width";
    width?: number;
    sizes?: string;
};
/**
 * One stored image: where the route serves it, its real size, its focal point, its version (`imageVersion`: the
 * stored hash or updated time) and the placeholder and main color stored at upload (site-api's media row).
 */
export type StoredImage = {
    src: string;
    width: number | null;
    height: number | null;
    focus?: string | null;
    version?: unknown;
    placeholder?: string | null;
    color?: string | null;
};
/**
 * What `defineImages` returns: the page half and the route half over one closed set.
 * - `widths`: The closed width set, ascending.
 * - `url`: One size's URL; with no width, the original, versioned.
 * - `shareImage`: og:image: 1200 x 630 around the focal point, image/jpeg; null with no size or not a raster. Needs `shareImages`.
 * - `articleImages`: Article `image`: 16:9, 4:3 and 1:1 at 1200 wide, image/webp; [] with no size or not a raster. Needs `shareImages`.
 * - `respond`: The original for a bare request, one transformed size for `?w=` (a GIF's first frame for `still=1`); 400 for anything outside the closed sets, and for a still of anything but a GIF.
 * - `serve`: The /media route around `respond`: GET and HEAD only (405), the key from the path after `prefix` ("/media/"), `keyPrefix` put before it, refused (404) unless every segment is safe and it starts with `within`; `read(key)` reads (and rereads) it; `cacheControl` (default versionedCache()) is a string or a function of the file. Every answer, refusals too, carries UPLOAD_HEADERS.
 */
export type Images<U extends string> = {
    widths: number[];
    ratios: string[];
    url(src: string, options: {
        width?: number;
        format?: ImageFormat | "jpeg";
        ratio?: string;
        focus?: string | null;
        still?: boolean;
        version?: string | number | Date | null;
    }): string;
    attributes(image: StoredImage, use: U): ImageAttributes;
    shareImage(image: StoredImage): SizedImageUrl | null;
    articleImages(image: StoredImage): SizedImageUrl[];
    respond(request: Request, options: {
        object: R2ObjectLike | null;
        images?: ImagesLike;
        cache?: Cache;
        cacheControl?: string;
        reread?: () => Promise<R2ObjectLike | null>;
    }): Promise<Response>;
    serve(request: Request, options: {
        read: (key: string) => Promise<R2ObjectLike | null>;
        images?: ImagesLike;
        cache?: Cache;
        prefix?: string;
        keyPrefix?: string;
        within?: string;
        cacheControl?: string | ((file: {
            request: Request;
            url: URL;
            key: string;
            object: R2ObjectLike;
        }) => string | undefined | Promise<string | undefined>);
    }): Promise<Response>;
};
export type ImageLayout = "constrained" | "fixed" | "full-width";
export type ImageFormat = "avif" | "webp";
/**
 * Where a site's addresses for stored files live: its own origins, the route's prefix, keyPrefix and within.
 */
export type AddressOptions = {
    /**
     * The site's own origins ("https://example.com"); an absolute address on any other host names no file.
     */
    origins?: string[] | undefined;
    /**
     * The route's path prefix. Default "/media/".
     */
    prefix?: string | undefined;
    /**
     * Put in front of the path to make the stored key, as the route's `keyPrefix`.
     */
    keyPrefix?: string | undefined;
    /**
     * The prefix every stored key has, as the route's `within`.
     */
    within?: string | undefined;
};
/**
 * An image for a share tag or structured data: its URL, size and served type.
 */
export type SizedImageUrl = {
    url: string;
    width: number;
    height: number;
    type: string;
};
export type ImageAttributes = {
    src: string;
    srcset: string | undefined;
    sizes: string | undefined;
    /**
     * AVIF then WebP, for a `<picture>`; empty when the image gets no srcset. A GIF's are its still first frame (AVIF then WebP, each with `media` "(prefers-reduced-motion: reduce)"), then the animated WebP.
     */
    sources: Array<{
        type: string;
        srcset: string;
        media?: string;
    }>;
    width: number | undefined;
    height: number | undefined;
    /**
     * The CSS background shown while it loads (placeholder over color, at the focal point); JPEG, WebP and AVIF only.
     */
    background: string | undefined;
};
export type PictureProps = {
    /**
     * One `<source>` each; empty when the page writes the `<img>` alone.
     */
    sources: Array<{
        type: string;
        srcSet: string;
        sizes: string | undefined;
        media: string | undefined;
    }>;
    img: {
        src: string;
        srcSet: string | undefined;
        sizes: string | undefined;
        width: number | undefined;
        height: number | undefined;
        alt: string;
        className: string | undefined;
        loading: "eager" | "lazy";
        fetchPriority: "high" | undefined;
        decoding: "async";
        style: {
            background?: string;
            objectPosition?: string;
        } | undefined;
    };
};
export type EditFormat = "image/jpeg" | "image/png" | "image/webp" | "image/avif";
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
