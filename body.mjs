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
  if (!Number.isInteger(max) || max < 0) throw new RangeError(`the ceiling must be a whole number of bytes, got ${max}`);
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
        // cancelled too, and the caller reads that branch only after this returns.
        void reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch (error) {
    throw new Error(`the body stream failed after ${total} bytes: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
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
