import { mediaType, textResponse } from "./http.mjs";
import { errors, schemaIssues } from "./http-errors.mjs";
import { errorMessage } from "./log.mjs";

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
export async function readCappedBytes(source, max) {
  if (!Number.isInteger(max) || max < 0)
    throw new RangeError(`the ceiling must be a whole number of bytes, got ${max}`);
  if (!source.body) return new Uint8Array(0);
  const reader = source.body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > max) {
        // Not awaited: canceling one branch of a tee (request.clone()) settles only once the other branch is read or
        // canceled too, and the caller reads that branch only after this returns.
        void reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch (error) {
    throw new Error(`the body stream failed after ${total} bytes: ${errorMessage(error)}`, {
      cause: error,
    });
  }
  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  return joined;
}

/**
 * `readCappedBytes`, decoded as UTF-8: "" for no body, null when over the ceiling.
 * @param {{ body: ReadableStream<Uint8Array> | null }} source
 * @param {number} max
 * @returns {Promise<string | null>}
 */
export async function readCapped(source, max) {
  const bytes = await readCappedBytes(source, max);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}

/**
 * The refusal for a JSON route's body that is not JSON (ASVS 3.5.2), or null when its Content-Type is
 * `application/json` or a `+json` type. A form or `text/plain` body is one a page on any site can send without a
 * preflight, so a route that reads JSON and takes a cookie refuses both with 415 before it reads a byte.
 * @param {{ headers: Headers }} request
 * @returns {Response | null}
 */
export function requireJson(request) {
  const type = mediaType(request.headers.get("Content-Type"));
  if (type === "application/json" || /^application\/[a-z0-9.+-]+\+json$/.test(type)) return null;
  return textResponse("This route takes application/json only.", 415);
}

/**
 * The refusal for a body over its ceiling: 413, uncacheable. Thrown by the readers below for a route to answer with.
 * @returns {Response}
 */
export function payloadTooLarge() {
  return textResponse("Payload Too Large", 413);
}

/**
 * The body as text. Throws the 413 Response (payloadTooLarge) when it is longer than `max`.
 * @param {Request} request
 * @param {number} max the ceiling in bytes
 * @returns {Promise<string>}
 */
export async function readText(request, max) {
  const text = await readCapped(request, max);
  if (text === null) throw payloadTooLarge();
  return text;
}

/**
 * The body parsed as a form, read to `max` bytes as it arrives (`request.formData()` holds the whole body in memory
 * before anything can refuse it). Over the ceiling, throws the 413; a body that is no form throws as formData() does.
 * @param {Request} request
 * @param {number} max the ceiling in bytes
 * @returns {Promise<FormData>}
 */
export async function readForm(request, max) {
  const bytes = await readCappedBytes(request, max);
  if (bytes === null) throw payloadTooLarge();
  return new Response(/** @type {Uint8Array<ArrayBuffer>} */ (bytes), {
    headers: { "Content-Type": request.headers.get("Content-Type") ?? "" },
  }).formData();
}

/**
 * The body parsed as JSON, read to `max` bytes. Throws the 413 over the ceiling, and (unless `typed` is false) the 415
 * first for a body that is not typed JSON (requireJson): a form or text/plain post is one any page can send with the
 * session cookie and no preflight. A body that is not JSON throws as JSON.parse does.
 * @param {Request} request
 * @param {number} max the ceiling in bytes
 * @param {{ typed?: boolean }} [options] `typed: false` skips the Content-Type check (a beacon that posts text/plain)
 * @returns {Promise<unknown>}
 */
export async function readJson(request, max, { typed = true } = {}) {
  if (typed) {
    const refused = requireJson(request);
    if (refused) throw refused;
  }
  return JSON.parse(await readText(request, max));
}

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
export async function readJsonWith(request, schema, { max, typed = true, empty }) {
  const text = await readCapped(request, max);
  if (text === null) throw errors.tooLarge();
  if (text === "" && empty !== undefined) return check(schema, empty);
  if (typed && requireJson(request)) throw errors.unsupportedType();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw errors.validation([{ path: "", message: "Expected a JSON body." }]);
  }
  return check(schema, value);
}

/**
 * @template T
 * @param {{ safeParse(value: unknown): { success: true, data: T } | { success: false, error: { issues: unknown[] } } }} schema
 * @param {unknown} value
 * @returns {T}
 */
function check(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw errors.validation(schemaIssues(result.error.issues));
}

const CRLF2 = new Uint8Array([13, 10, 13, 10]);
// The longest a part's headers (or the preamble before the first boundary) may run before the body is refused.
const PART_HEADER_LIMIT = 16 * 1024;

/**
 * The refusal for a multipart body that does not parse: 400, uncacheable.
 * @param {string} [message]
 * @returns {Response}
 */
function malformedUpload(message = "Could not read the upload. Try again.") {
  return textResponse(message, 400);
}

/**
 * Where `needle` first starts in `haystack`, or -1. The native indexOf jumps to each candidate first byte, so a large
 * file is scanned at native speed.
 * @param {Uint8Array} haystack
 * @param {Uint8Array} needle
 */
function bytesIndexOf(haystack, needle) {
  const last = haystack.length - needle.length;
  for (
    let i = haystack.indexOf(needle[0]);
    i !== -1 && i <= last;
    i = haystack.indexOf(needle[0], i + 1)
  ) {
    let j = 1;
    while (j < needle.length && haystack[i + j] === needle[j]) j++;
    if (j === needle.length) return i;
  }
  return -1;
}

/**
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 */
function joinBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/**
 * The boundary from a multipart/form-data Content-Type, or null for any other type.
 * @param {string | null} contentType
 * @returns {string | null}
 */
export function multipartBoundary(contentType) {
  if (!contentType || !/^multipart\/form-data\s*;/i.test(contentType)) return null;
  const match = /;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  return match ? (match[1] ?? match[2] ?? null) : null;
}

/**
 * A multipart/form-data body read as it arrives, one part at a time, so a large file goes on to R2 without the whole
 * request held in memory (`request.formData()` and `readForm` buffer every byte). Read each part's body before asking
 * for the next; what is left of a part is skipped. Over `max` bytes in all, throws the 413 (payloadTooLarge); a body
 * that is not multipart, or does not parse, throws a 400 Response. `readForm` stays the reader for small forms.
 * @param {Request} request
 * @param {number} max the ceiling in bytes, for the whole body
 * @returns {AsyncGenerator<import("./body.mjs").MultipartPart>}
 */
export async function* readMultipart(request, max) {
  if (!Number.isInteger(max) || max < 0)
    throw new RangeError(`the ceiling must be a whole number of bytes, got ${max}`);
  const boundary = multipartBoundary(request.headers.get("Content-Type"));
  if (!boundary || !request.body) throw malformedUpload();
  const reader = request.body.getReader();
  const delimiter = new TextEncoder().encode(`\r\n--${boundary}`);
  // A leading CRLF lets the first boundary match the same delimiter as the rest.
  /** @type {Uint8Array} */
  let buf = new Uint8Array([13, 10]);
  let total = 0;

  async function more() {
    const { done, value } = await reader.read();
    if (done) throw malformedUpload();
    total += value.length;
    if (total > max) {
      void reader.cancel().catch(() => {});
      throw payloadTooLarge();
    }
    buf = buf.length ? joinBytes(buf, value) : value;
  }

  /** @param {Uint8Array} needle */
  async function find(needle) {
    for (;;) {
      const at = bytesIndexOf(buf, needle);
      if (at >= 0) return at;
      if (buf.length > PART_HEADER_LIMIT) throw malformedUpload();
      await more();
    }
  }

  try {
    const first = await find(delimiter); // before reading buf: find may grow it
    buf = buf.subarray(first + delimiter.length);
    for (;;) {
      while (buf.length < 2) await more();
      if (buf[0] === 45 && buf[1] === 45) return; // "--": the closing boundary
      const end = await find(CRLF2);
      const headers = new TextDecoder().decode(buf.subarray(2, Math.max(2, end)));
      buf = buf.subarray(end + 4);
      const disposition = /^content-disposition:(.*)$/im.exec(headers)?.[1] ?? "";
      const name = /\bname="([^"]*)"/i.exec(disposition)?.[1];
      if (name === undefined) throw malformedUpload();
      const filename = /\bfilename="([^"]*)"/i.exec(disposition)?.[1] ?? null;
      const type = /^content-type:\s*([^;\r\n]*)/im.exec(headers)?.[1]?.trim().toLowerCase() ?? "";

      let finished = false;
      // Bytes go out as they come, all but a delimiter's length, which may be the start of the next boundary.
      const chunks = async function* () {
        while (!finished) {
          const at = bytesIndexOf(buf, delimiter);
          if (at >= 0) {
            const last = buf.subarray(0, at);
            buf = buf.subarray(at + delimiter.length);
            finished = true;
            if (last.length) yield last;
            return;
          }
          const keep = delimiter.length - 1;
          if (buf.length > keep) {
            const out = buf.subarray(0, buf.length - keep);
            buf = buf.slice(buf.length - keep);
            yield out;
          }
          await more();
        }
      };
      yield { name, filename, type, chunks };
      for await (const _ of chunks()) {
        // skip what the caller left unread
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * A text field's value, read to at most `max` bytes (64 KiB by default); longer throws a 400 Response naming the field.
 * @param {import("./body.mjs").MultipartPart} part
 * @param {number} [max]
 * @returns {Promise<string>}
 */
export async function partText(part, max = 64 * 1024) {
  /** @type {Uint8Array} */
  let bytes = new Uint8Array(0);
  for await (const chunk of part.chunks()) {
    bytes = joinBytes(bytes, chunk);
    if (bytes.length > max) throw malformedUpload(`The ${part.name} field is too long.`);
  }
  return new TextDecoder().decode(bytes);
}
