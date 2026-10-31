/** A request body read to a byte ceiling, counted as it arrives (body.mjs). */
type BodySource = { body: ReadableStream<Uint8Array> | null };
/** The body (empty when there is none), or null when longer than `max`. Throws when the stream fails mid-read. */
export function readCappedBytes(source: BodySource, max: number): Promise<Uint8Array | null>;
/** `readCappedBytes` decoded as UTF-8: "" for no body, null when over the ceiling. */
export function readCapped(source: BodySource, max: number): Promise<string | null>;
/** 415 for a body whose Content-Type is not application/json or a +json type (a form, text/plain), else null. */
export function requireJson(request: { headers: Headers }): Response | null;
