/** An ask box's stream frames, answer cache key and answer guard (ai-ask.mjs). */

/** The event the guard sends after an answer the model did not finish: `cut`. */
export const CUT_EVENT: "cut";
/** One frame's event name and its `data:` lines joined. */
export function frameFields(frame: string): { event: string; data: string };
/** The complete frames off the front of a buffer; the unfinished tail is `rest`. Frames with no JSON data are left out. */
export function takeSseFrames(buffer: string): {
  frames: Array<{ event: string; data: unknown }>;
  rest: string;
};
/** The text a completion frame adds (`choices[0].delta.content`), or undefined. */
export function answerDelta(data: unknown): string | undefined;
/** Why the model stopped (`choices[0].finish_reason`), or undefined. */
export function finishReason(data: unknown): string | undefined;
/** Lowercased, whitespace collapsed, trailing punctuation dropped. */
export function normalizeQuestion(question: string): string;
/** `prefix` (default `ask:answer:`) and the SHA-256 hex of the normalised question. */
export function answerKey(question: string, prefix?: string): Promise<string>;
/** A cached answer as the frames a live one sends. */
export function replayFrames(cached: { answer: string; chunks: unknown[] }): string[];
/**
 * The answer shown a paragraph at a time, each checked whole first; a refused paragraph, an empty, unreadable or
 * hidden-citing chunks frame, or a missing one ends it (replaced by `noAnswerText` when nothing was shown). A cut answer
 * is followed by a `cut` event.
 */
export function guardAnswerStream(
  upstream: ReadableStream,
  options: {
    resolveVisible: (slugs: string[]) => Promise<Set<string>>;
    citedSlugs: (chunks: unknown[]) => string[];
    noAnswerText: string;
    timeoutMs?: number;
    checkProse?: (paragraph: string) => Array<{ check: string; severity: string }>;
    onRefused?: () => void;
    onCut?: (reason: string) => void;
  },
): ReadableStream;
