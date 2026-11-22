/**
 * An abort signal that fires when `ms` pass without `touch()` (`first` before the first touch): a stream's no-progress
 * timeout.
 * @param {number} ms
 * @param {number} [first]
 */
export function idleTimer(ms, first = ms) {
  const controller = new AbortController();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const touch = (wait = ms) => {
    clearTimeout(timer);
    timer = setTimeout(
      () => controller.abort(new DOMException("No data from the stream", "TimeoutError")),
      wait,
    );
  };
  touch(first);
  return { signal: controller.signal, touch, stop: () => clearTimeout(timer) };
}

/**
 * The server-sent events of a response body, each `{ event, data }` with `data` parsed. Each chunk resets the idle timer.
 * @param {ReadableStream<Uint8Array> | null} body
 * @param {{ touch: () => void }} idle
 * @returns {AsyncGenerator<{ event: string; data: any }>}
 */
export async function* sse(body, idle) {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // A CR that ends a chunk may be the first half of a CRLF split across two, so it waits for the next chunk.
  let carry = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      idle.touch();
      const text = carry + decoder.decode(value, { stream: true });
      carry = text.endsWith("\r") ? "\r" : "";
      buffer += (carry ? text.slice(0, -1) : text).replace(/\r\n?/g, "\n");
      let end = buffer.indexOf("\n\n");
      while (end !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        end = buffer.indexOf("\n\n");
        let event = "message";
        let data = "";
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trimStart();
        }
        if (!data) continue;
        try {
          yield { event, data: JSON.parse(data) };
        } catch {
          // A frame that is not JSON is skipped, as an unknown event would be.
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}
