/** A request body read to a byte ceiling, counted as it arrives (body.mjs). */
type BodySource = { body: ReadableStream<Uint8Array> | null };
/** The body (empty when there is none), or null when longer than `max`. Throws when the stream fails mid-read. */
export function readCappedBytes(source: BodySource, max: number): Promise<Uint8Array | null>;
/** `readCappedBytes` decoded as UTF-8: "" for no body, null when over the ceiling. */
export function readCapped(source: BodySource, max: number): Promise<string | null>;
/** 415 for a body whose Content-Type is not application/json or a +json type (a form, text/plain), else null. */
export function requireJson(request: { headers: Headers }): Response | null;
/** The refusal for a body over its ceiling: 413, uncacheable. */
export function payloadTooLarge(): Response;
/** The body as text; throws the 413 Response when it is longer than `max` bytes. */
export function readText(request: Request, max: number): Promise<string>;
/** The body parsed as a form, read to `max` bytes as it arrives; throws the 413 over the ceiling. */
export function readForm(request: Request, max: number): Promise<FormData>;
/** The body parsed as JSON, read to `max` bytes; throws the 413 over it and the 415 for an untyped body unless `typed` is false. */
export function readJson(
  request: Request,
  max: number,
  options?: { typed?: boolean },
): Promise<unknown>;

/** One part of a multipart/form-data body, as readMultipart yields it. */
export interface MultipartPart {
  name: string;
  /** The file name for a file part ("" when the picker was left empty), null for a text field. */
  filename: string | null;
  /** The part's Content-Type, lowercased, without parameters ("" when it has none). */
  type: string;
  /** The part's bytes. Each call goes on from where the last stopped, so a reader may break out and call again. */
  chunks(): AsyncGenerator<Uint8Array>;
}
/** The boundary from a multipart/form-data Content-Type, or null for any other type. */
export function multipartBoundary(contentType: string | null): string | null;
/** A multipart body one part at a time as it arrives; throws the 413 over `max` in all, a 400 Response when it does not parse. */
export function readMultipart(request: Request, max: number): AsyncGenerator<MultipartPart>;
/** A text part's value, read to `max` bytes (64 KiB); longer throws a 400 Response naming the field. */
export function partText(part: MultipartPart, max?: number): Promise<string>;

/** The body read to `max`, checked by a zod-shaped schema; throws AppError 413, 415 or 422 (./http-errors). */
export function readJsonWith<T>(
  request: Request,
  schema: {
    safeParse(
      value: unknown,
    ): { success: true; data: T } | { success: false; error: { issues: unknown[] } };
  },
  options: { max: number; typed?: boolean; empty?: unknown },
): Promise<T>;
