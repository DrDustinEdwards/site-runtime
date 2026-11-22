/**
 * One frame's event name and its data lines joined, each with its `data:` prefix removed.
 * @param {string} frame one frame, without its blank-line terminator
 * @returns {{ event: string, data: string }}
 */
export function frameFields(frame: string): {
    event: string;
    data: string;
};
/**
 * The complete frames off the front of a buffer, with the unfinished tail as `rest`. A frame with no data, the `[DONE]`
 * sentinel, or data that is not JSON carries nothing to show and is left out.
 * @param {string} buffer everything decoded and not yet consumed
 * @returns {{ frames: Array<{ event: string, data: unknown }>, rest: string }}
 */
export function takeSseFrames(buffer: string): {
    frames: Array<{
        event: string;
        data: unknown;
    }>;
    rest: string;
};
/**
 * The text a completion frame adds to the answer, or undefined for a frame that adds none.
 * @param {unknown} data a parsed frame's data
 * @returns {string | undefined}
 */
export function answerDelta(data: unknown): string | undefined;
/**
 * Why the model stopped, from a frame's `choices[0].finish_reason`, or undefined for a frame that does not say.
 * `"stop"` is a finished answer; `"length"` one cut at `max_tokens`.
 * @param {unknown} data a parsed frame's data
 * @returns {string | undefined}
 */
export function finishReason(data: unknown): string | undefined;
/**
 * A question as its cache key sees it: lowercased, whitespace collapsed, trailing punctuation dropped. No stemming or
 * stopword dropping: differently worded questions must not share an answer.
 * @param {string} question
 */
export function normalizeQuestion(question: string): string;
/**
 * The key a question's answer is cached under: `prefix` and the SHA-256 of the normalized question, so a prefix scan
 * (KV list) can drop every cached answer at once.
 * @param {string} question
 * @param {string} [prefix] default `ask:answer:`
 */
export function answerKey(question: string, prefix?: string): Promise<string>;
/**
 * A cached answer as the frames the live one sends: the chunks, the text, the end.
 * @param {{ answer: string, chunks: unknown[] }} cached
 * @returns {string[]}
 */
export function replayFrames(cached: {
    answer: string;
    chunks: unknown[];
}): string[];
/**
 * The answer shown a paragraph at a time: each is held until its blank line (or the end of the stream), checked whole,
 * and only then sent. The chunks frame is checked first (a refusal there stops the model at once) and is held with the
 * first paragraph, so no citations show for an answer that never does. A refused paragraph ends the answer where it
 * stands; if nothing was shown yet, `noAnswerText` takes its place. `onRefused` hears every refusal, and the caller must
 * not cache that answer: a cut answer is not the answer. Only the chunks frame and the text reach the reader.
 *
 * - A zero-chunk answer came from the model's weights, not the site, and is replaced. FAILS CLOSED: a chunks frame that
 *   is not a JSON array, or a stream that ends without one, cannot be checked, so it is replaced too and logged as
 *   `ask_guard_unverifiable`, which is how a changed upstream frame order shows up.
 * - A chunks frame citing anything `resolveVisible` does not return refuses the whole answer, not just the link: the
 *   prose was written from those passages.
 * - A paragraph `checkProse` flags at high severity is not shown.
 * - An answer the model did not finish (a `finish_reason` other than `stop`) is shown as far as it got, then a `cut` event
 *   names the reason; `onCut` hears it, and the caller must not cache that answer either.
 * - A stalled upstream ends the answer once `timeoutMs` passes with nothing read (an idle timeout: an answer that keeps
 *   streaming is never cut for its length).
 * @param {ReadableStream} upstream
 * @param {{
 *   resolveVisible: (slugs: string[]) => Promise<Set<string>>,
 *   citedSlugs: (chunks: unknown[]) => string[],
 *   noAnswerText: string,
 *   timeoutMs?: number,
 *   checkProse?: (paragraph: string) => Array<{ check: string, severity: string }>,
 *   onRefused?: () => void,
 *   onCut?: (reason: string) => void,
 * }} options `citedSlugs` is what a chunk cites on this site (a chunk naming nothing contributes nothing);
 *   `resolveVisible` answers which of those a reader may see
 * @returns {ReadableStream}
 */
export function guardAnswerStream(upstream: ReadableStream, { resolveVisible, citedSlugs, noAnswerText, timeoutMs, checkProse, onRefused, onCut, }: {
    resolveVisible: (slugs: string[]) => Promise<Set<string>>;
    citedSlugs: (chunks: unknown[]) => string[];
    noAnswerText: string;
    timeoutMs?: number;
    checkProse?: (paragraph: string) => Array<{
        check: string;
        severity: string;
    }>;
    onRefused?: () => void;
    onCut?: (reason: string) => void;
}): ReadableStream;
/** The event the guard sends after an answer the model did not finish, so the reader is told it was cut. */
export const CUT_EVENT: "cut";
