/**
 * An abort signal that fires when `ms` pass without `touch()` (`first` before the first touch): a stream's no-progress
 * timeout.
 * @param {number} ms
 * @param {number} [first]
 */
export function idleTimer(ms: number, first?: number): {
    signal: AbortSignal;
    touch: (wait?: number) => void;
    stop: () => void;
};
/**
 * The server-sent events of a response body, each `{ event, data }` with `data` parsed. Each chunk resets the idle timer.
 * @param {ReadableStream<Uint8Array> | null} body
 * @param {{ touch: () => void }} idle
 * @returns {AsyncGenerator<{ event: string; data: any }>}
 */
export function sse(body: ReadableStream<Uint8Array> | null, idle: {
    touch: () => void;
}): AsyncGenerator<{
    event: string;
    data: any;
}>;
