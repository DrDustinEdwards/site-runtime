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
