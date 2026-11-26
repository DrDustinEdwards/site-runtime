/**
 * A request body read to a byte ceiling, counted as it arrives.
 * @typedef {object} BodySource
 * @property {ReadableStream<Uint8Array> | null} body
 */
/**
 * One part of a multipart/form-data body, as readMultipart yields it.
 *
 * - `filename`: The file name for a file part ("" when the picker was left empty), null for a text field.
 * - `type`: The part's Content-Type, lowercased, without parameters ("" when it has none).
 * - `chunks`: The part's bytes. Each call goes on from where the last stopped, so a reader may break out and call again.
 * @typedef {{ name: string; filename: string | null; type: string; chunks(): AsyncGenerator<Uint8Array>; }} MultipartPart
 */
/**
 * A request body read to a byte ceiling, counted as the chunks arrive. The declared Content-Length can be absent or
 * understated, and `request.text()` holds the whole body in memory before any check can run, so neither is a cap.
 *
 * Over the ceiling is `null`, never a truncated body, so the caller answers 413 instead of parsing a fragment. A
 * stream that fails mid-read THROWS: an empty body is no safe stand-in, because every caller parses what it gets.
 */
/**
 * @param {{ body: ReadableStream<Uint8Array> | null }} source a Request, or anything with a body stream
 * @param {number} max the ceiling in bytes
 * @returns {Promise<Uint8Array | null>} the body (empty when there is none), or null when it is longer than `max`
 */
export function readCappedBytes(source: {
    body: ReadableStream<Uint8Array> | null;
}, max: number): Promise<Uint8Array | null>;
/**
 * @param {{ body: ReadableStream<Uint8Array> | null }} source
 * @param {number} max
 * @returns {Promise<string | null>}
 */
export function readCapped(source: {
    body: ReadableStream<Uint8Array> | null;
}, max: number): Promise<string | null>;
/**
 * The refusal for a JSON route's body that is not JSON (ASVS 3.5.2), or null when its Content-Type is
 * `application/json` or a `+json` type. A form or `text/plain` body is one a page on any site can send without a
 * preflight, so a route that reads JSON and takes a cookie refuses both with 415 before it reads a byte.
 * @param {{ headers: Headers }} request
 * @returns {Response | null}
 */
export function requireJson(request: {
    headers: Headers;
}): Response | null;
/**
 * The refusal for a body over its ceiling: 413, uncacheable. Thrown by the readers below for a route to answer with.
 * @returns {Response}
 */
export function payloadTooLarge(): Response;
/**
 * @param {Request} request
 * @param {number} max the ceiling in bytes
 * @returns {Promise<string>}
 */
export function readText(request: Request, max: number): Promise<string>;
/**
 * The body parsed as a form, read to `max` bytes as it arrives (`request.formData()` holds the whole body in memory
 * before anything can refuse it). Over the ceiling, throws the 413; a Content-Type that is not a form type throws a 415
 * (as readJson does) and a form body that does not parse a 400, so a stray POST is a refusal and no reported error.
 * @param {Request} request
 * @param {number} max the ceiling in bytes
 * @returns {Promise<FormData>}
 */
export function readForm(request: Request, max: number): Promise<FormData>;
/**
 * The body parsed as JSON, read to `max` bytes. Throws the 413 over the ceiling, and (unless `typed` is false) the 415
 * first for a body that is not typed JSON (requireJson): a form or text/plain post is one any page can send with the
 * session cookie and no preflight. A body that is not JSON throws as JSON.parse does.
 * @param {Request} request
 * @param {number} max the ceiling in bytes
 * @param {{ typed?: boolean }} [options] `typed: false` skips the Content-Type check (a beacon that posts text/plain)
 * @returns {Promise<unknown>}
 */
export function readJson(request: Request, max: number, { typed }?: {
    typed?: boolean;
}): Promise<unknown>;
/**
 * The body read to `max` bytes and checked by a schema, for a JSON API that answers in problem details
 * (./http-errors): over the ceiling throws AppError 413 `too_large`, a body that is not typed JSON 415
 * `unsupported_type` (unless `typed` is false), one that does not parse or fails the schema 422 `validation` with the
 * issues as `errors`. An empty body is validated as `empty` when given (an optional body), else refused as not JSON.
 * The schema is anything with zod's `safeParse` (zod 3 or 4); nothing here imports zod.
 * @template T
 * @param {Request} request
 * @param {{ safeParse(value: unknown): { success: true, data: T } | { success: false, error: { issues: unknown[] } } }} schema
 * @param {{ max: number, typed?: boolean, empty?: unknown }} options
 * @returns {Promise<T>}
 */
export function readJsonWith<T>(request: Request, schema: {
    safeParse(value: unknown): {
        success: true;
        data: T;
    } | {
        success: false;
        error: {
            issues: unknown[];
        };
    };
}, { max, typed, empty }: {
    max: number;
    typed?: boolean;
    empty?: unknown;
}): Promise<T>;
/**
 * @param {string | null} contentType
 * @returns {string | null}
 */
export function multipartBoundary(contentType: string | null): string | null;
/**
 * A multipart/form-data body read as it arrives, one part at a time, so a large file goes on to R2 without the whole
 * request held in memory (`request.formData()` and `readForm` buffer every byte). Read each part's body before asking
 * for the next; what is left of a part is skipped. Over `max` bytes in all, throws the 413 (payloadTooLarge); a body
 * that is not multipart, or does not parse, throws a 400 Response. `readForm` stays the reader for small forms.
 * @param {Request} request
 * @param {number} max the ceiling in bytes, for the whole body
 * @returns {AsyncGenerator<MultipartPart>}
 */
export function readMultipart(request: Request, max: number): AsyncGenerator<MultipartPart>;
/**
 * A text field's value, read to at most `max` bytes (64 KiB by default); longer throws a 400 Response naming the field.
 * @param {MultipartPart} part
 * @param {number} [max]
 * @returns {Promise<string>}
 */
export function partText(part: MultipartPart, max?: number): Promise<string>;
/**
 * A request body read to a byte ceiling, counted as it arrives.
 */
export type BodySource = {
    body: ReadableStream<Uint8Array> | null;
};
/**
 * One part of a multipart/form-data body, as readMultipart yields it.
 *
 * - `filename`: The file name for a file part ("" when the picker was left empty), null for a text field.
 * - `type`: The part's Content-Type, lowercased, without parameters ("" when it has none).
 * - `chunks`: The part's bytes. Each call goes on from where the last stopped, so a reader may break out and call again.
 */
export type MultipartPart = {
    name: string;
    filename: string | null;
    type: string;
    chunks(): AsyncGenerator<Uint8Array>;
};
