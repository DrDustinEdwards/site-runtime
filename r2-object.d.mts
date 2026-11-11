/** One stored R2 object as an HTTP answer (r2-object.mjs): HEAD, ranges, 304, ETag, nosniff, Content-Disposition. */

export interface R2ObjectHeadLike {
  size: number;
  httpEtag: string;
  writeHttpMetadata(headers: Headers): void;
}
export interface R2ObjectBodyLike extends R2ObjectHeadLike {
  body: ReadableStream | null;
  range?: unknown;
}
export interface R2BucketLike {
  head(key: string): Promise<R2ObjectHeadLike | null>;
  get(key: string, options?: { range?: Headers }): Promise<R2ObjectBodyLike | null>;
}

export interface R2FileOptions {
  cacheControl?: string;
  /** Overrides the stored Content-Type (a PDF stored without one); application/octet-stream when neither has one. */
  contentType?: string;
  /** Writes Content-Disposition (with `filename`, RFC 6266 and RFC 8187). */
  disposition?: "inline" | "attachment";
  filename?: string;
  /** X-Robots-Tag: noindex, for a copy of a page's text. */
  noindex?: boolean;
  /** Cache-Tag, for a purge by tag. */
  tags?: string[];
  /** The 404's text. */
  notFound?: string;
}

/** The Content-Disposition value: an ASCII `filename`, and `filename*` in UTF-8 when the name needs it. */
export function contentDisposition(disposition: "inline" | "attachment", filename?: string): string;
/** A body the Worker made, as a download: type, Content-Disposition (attachment), nosniff, no-store. */
export function attachmentResponse(
  body: BodyInit,
  options: {
    filename: string;
    type: string;
    disposition?: "inline" | "attachment";
    cacheControl?: string;
  },
): Response;
/** The object as the answer: 405, 404, 304, 206, 416 or 200, with HEAD answered from `head`. */
export function r2ObjectResponse(
  request: Request,
  bucket: R2BucketLike,
  key: string,
  options?: R2FileOptions,
): Promise<Response>;
