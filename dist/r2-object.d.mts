/**
 * One stored R2 object as an HTTP answer (r2-object.mjs): HEAD, ranges, 304, ETag, nosniff, Content-Disposition.
 * @typedef {{ size: number; httpEtag: string; writeHttpMetadata(headers: Headers): void; }} R2ObjectHeadLike
 */
/**
 * @typedef {R2ObjectHeadLike & { body: ReadableStream | null; range?: unknown; }} R2ObjectBodyLike
 */
/**
 * @typedef {{ head(key: string): Promise<R2ObjectHeadLike | null>; get(key: string, options?: { range?: Headers }): Promise<R2ObjectBodyLike | null>; }} R2BucketLike
 */
/**
 * @typedef {object} R2FileOptions
 * @property {string} [cacheControl]
 * @property {string} [contentType] Overrides the stored Content-Type (a PDF stored without one); application/octet-stream when neither has one.
 * @property {"inline" | "attachment"} [disposition] Writes Content-Disposition (with `filename`, RFC 6266 and RFC 8187).
 * @property {string} [filename]
 * @property {boolean} [noindex] X-Robots-Tag: noindex, for a copy of a page's text.
 * @property {string[]} [tags] Cache-Tag, for a purge by tag.
 * @property {string} [notFound] The 404's text.
 */
/**
 * Runs an R2 read again, once after 300 ms, when R2 answers its transient 10001 or 10043 (its docs: retry); any other
 * error, and a second failure, is thrown as it was.
 * @template T
 * @param {() => Promise<T>} read
 * @returns {Promise<T>}
 */
export function retryR2Read<T>(read: () => Promise<T>): Promise<T>;
/**
 * The Content-Disposition value for `disposition` ("inline" or "attachment") and a file name. Quotes, backslashes and
 * control characters are dropped; a name outside printable ASCII also gets `filename*` in UTF-8.
 * @param {"inline" | "attachment"} disposition
 * @param {string} [filename]
 * @returns {string}
 */
export function contentDisposition(disposition: "inline" | "attachment", filename?: string): string;
/**
 * A body the Worker made, as a download: its type, Content-Disposition (attachment by default), nosniff, no-store.
 * @param {BodyInit} body
 * @param {{ filename: string, type: string, disposition?: "inline" | "attachment", cacheControl?: string }} options
 * @returns {Response}
 */
export function attachmentResponse(body: BodyInit, { filename, type, disposition, cacheControl }: {
    filename: string;
    type: string;
    disposition?: "inline" | "attachment";
    cacheControl?: string;
}): Response;
/**
 * The object at `key` as the answer to `request`: 405 for a method other than GET and HEAD, 404 when there is no such
 * object, 304 when If-None-Match names it, 206 for a byte range, 416 for a range past its end, else 200.
 * @param {Request} request
 * @param {R2BucketLike} bucket
 * @param {string} key
 * @param {R2FileOptions} [options]
 * @returns {Promise<Response>}
 */
export function r2ObjectResponse(request: Request, bucket: R2BucketLike, key: string, options?: R2FileOptions): Promise<Response>;
/**
 * One stored R2 object as an HTTP answer (r2-object.mjs): HEAD, ranges, 304, ETag, nosniff, Content-Disposition.
 */
export type R2ObjectHeadLike = {
    size: number;
    httpEtag: string;
    writeHttpMetadata(headers: Headers): void;
};
export type R2ObjectBodyLike = R2ObjectHeadLike & {
    body: ReadableStream | null;
    range?: unknown;
};
export type R2BucketLike = {
    head(key: string): Promise<R2ObjectHeadLike | null>;
    get(key: string, options?: {
        range?: Headers;
    }): Promise<R2ObjectBodyLike | null>;
};
export type R2FileOptions = {
    cacheControl?: string | undefined;
    /**
     * Overrides the stored Content-Type (a PDF stored without one); application/octet-stream when neither has one.
     */
    contentType?: string | undefined;
    /**
     * Writes Content-Disposition (with `filename`, RFC 6266 and RFC 8187).
     */
    disposition?: "inline" | "attachment" | undefined;
    filename?: string | undefined;
    /**
     * X-Robots-Tag: noindex, for a copy of a page's text.
     */
    noindex?: boolean | undefined;
    /**
     * Cache-Tag, for a purge by tag.
     */
    tags?: string[] | undefined;
    /**
     * The 404's text.
     */
    notFound?: string | undefined;
};
