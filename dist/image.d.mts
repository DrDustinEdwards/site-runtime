/**
 * The widths an image is offered at, by Astro's rules (full-width: every screen width; fixed: 1x and 2x; constrained:
 * 1x, 2x and every screen width up to 2x), never wider than the original.
 * @param {{ layout: "constrained" | "fixed" | "full-width", width?: number, originalWidth?: number, breakpoints?: number[] }} options
 */
export function imageWidths({ layout, width, originalWidth, breakpoints }: {
    layout: "constrained" | "fixed" | "full-width";
    width?: number;
    originalWidth?: number;
    breakpoints?: number[];
}): number[];
/** The `sizes` attribute for a layout, in CSS pixels.
 * @param {{ layout: "constrained" | "fixed" | "full-width", width?: number }} options
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
 */
export function defineImages<U extends string>({ uses, breakpoints, quality, shareImages, }: {
    uses: Record<U, ImageUse & {
        ratio?: string;
    }>;
    breakpoints?: number[];
    quality?: number;
    shareImages?: boolean;
}): {
    widths: any[];
    ratios: any[];
    url: (src: string, { width, format, ratio, focus, still, version }: {
        width?: number;
        format?: keyof typeof FORMAT_EXTENSIONS;
        ratio?: string;
        focus?: string | null;
        still?: boolean;
        version?: unknown;
    }) => string;
    attributes: (image: StoredImage, useName: U) => {
        src: string;
        srcset: undefined;
        sizes: undefined;
        sources: never[];
        width: number | undefined;
        height: number | undefined;
        background: undefined;
    } | {
        src: string;
        srcset: string;
        sizes: string | undefined;
        sources: ({
            type: "image/avif";
            srcset: string;
            media: string;
        } | {
            type: "image/webp";
            srcset: string;
            media: string;
        } | {
            type: "image/webp";
            srcset: string;
            media?: undefined;
        })[] | ({
            type: "image/avif";
            srcset: string;
        } | {
            type: "image/webp";
            srcset: string;
        })[];
        width: number;
        height: number;
        background: string | undefined;
    };
    shareImage: (image: StoredImage) => {
        url: string;
        width: 1200;
        height: number;
        type: string;
    } | null;
    articleImages: (image: StoredImage) => {
        url: string;
        width: 1200;
        height: number;
        type: "image/webp";
    }[];
    respond: (request: Request, options: {
        object: R2ObjectLike | null;
        images?: ImagesLike;
        cache?: Cache;
        cacheControl?: string;
        reread?: () => Promise<R2ObjectLike | null>;
    }) => Promise<Response>;
    serve: (request: Request, { read, images, cache, prefix, keyPrefix, within, cacheControl, }: {
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
    }) => Promise<Response>;
};
export { editImage } from "./image-edit.mjs";
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
export const SCREEN_WIDTHS: number[];
/** The longest side Cloudflare Images encodes as AVIF (its documented limit); a larger size is offered as WebP. */
export const AVIF_MAX_EDGE: 1200;
export namespace SHARE_IMAGE {
    let width: 1200;
    let ratio: "40x21";
    let format: "jpeg";
}
export const ARTICLE_IMAGE_RATIOS: readonly ["16x9", "4x3", "1x1"];
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
export type ImageFormat = "avif" | "webp";
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
declare namespace FORMAT_EXTENSIONS {
    let avif: "avif";
    let webp: "webp";
    let jpeg: "jpg";
}
export { FOCUS_METADATA, IMAGE_FORMATS, IMAGE_QUALITY, IMMUTABLE_CACHE, RASTER_PATH, RASTER_TYPES, assetsObject, focalPosition, focusOf, imageVersion, keyOfAddress, keysAtAddresses, mediaKey, originalKey, versionedCache } from "./image-core.mjs";
export { imagePreload, pictureHtml, pictureProps } from "./image-markup.mjs";
