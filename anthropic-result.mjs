/** The result of one Messages call: stop reasons, typed failures and token totals (see anthropic.mjs). */

import { priceOf, promptOf } from "./ai-engine.mjs";
import { scrubText } from "./log.mjs";

/** @import { RawResult, TokenCounts, Usage } from "./anthropic.mjs" */

/** What a reader may be shown for each kind of failure. */
export const FAILURE_TEXT = /* @__PURE__ */ Object.freeze({
  truncated: "The answer was cut off before it finished.",
  context_window: "The request was too long for the assistant to answer.",
  refusal: "The assistant declined to answer this request.",
  paused: "The answer took too many steps to finish.",
  unexpected_stop: "The answer did not finish normally.",
  invalid_output: "The answer was not in the expected form.",
  spend_limit: "AI features are paused for now.",
  rate_limited: "The AI service is busy. Try again in a moment.",
  unavailable: "The AI service is unavailable right now. Try again in a moment.",
  timeout: "The AI service took too long to answer. Try again in a moment.",
  aborted: "The request was canceled.",
  rejected: "The AI request could not be made.",
});
// Worth trying again later (not now: the retries here are already spent).
const RETRYABLE = new Set(["rate_limited", "unavailable", "timeout"]);

/**
 * A finished message as an answer or a typed failure, by its stop_reason.
 * @param {any} message
 * @returns {RawResult}
 */
export function stopped(message) {
  const stopReason = message.stop_reason ?? null;
  const text = (message.content ?? [])
    .filter((/** @type {any} */ block) => block?.type === "text")
    .map((/** @type {any} */ block) => block.text)
    .join("");
  switch (stopReason) {
    case "end_turn":
    case "stop_sequence":
    case "tool_use":
      return {
        ok: true,
        text,
        content: message.content,
        stopReason,
        stopSequence: message.stop_sequence ?? null,
      };
    case "max_tokens":
      return failure("truncated", { status: 200, stopReason, content: message.content });
    case "model_context_window_exceeded":
      return failure("context_window", { status: 200, stopReason, content: message.content });
    case "refusal":
      return failure("refusal", {
        status: 200,
        stopReason,
        stopDetails: message.stop_details ?? null,
      });
    case "pause_turn":
      return failure("paused", { status: 200, stopReason, content: message.content });
    default:
      return failure("unexpected_stop", { status: 200, stopReason, content: message.content });
  }
}

/**
 * @param {string} kind
 * @param {Record<string, unknown>} fields
 * @returns {RawResult}
 */
export function failure(kind, fields) {
  return {
    ok: false,
    kind,
    error: FAILURE_TEXT[/** @type {keyof typeof FAILURE_TEXT} */ (kind)],
    retryable: RETRYABLE.has(kind),
    ...fields,
  };
}

/** Adds a response's usage to the call's running totals.
 * @param {Usage} total
 * @param {any} usage
 * @param {string} model
 */
export function add(total, usage, model) {
  if (!usage) return;
  // The response splits cache writes by TTL in `cache_creation`; without it every write is a five-minute one.
  const split = usage.cache_creation;
  const one = {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: split
      ? (split.ephemeral_5m_input_tokens ?? 0)
      : (usage.cache_creation_input_tokens ?? 0),
    cacheWrite1h: split ? (split.ephemeral_1h_input_tokens ?? 0) : 0,
  };
  sum(total, one);
  // Requests over a model's long-prompt line are kept apart for ai-engine costMicros.
  const above = priceOf(model)?.long?.above;
  if (above !== undefined && promptOf(one) > above) sum(total.long, one);
}

/** @returns {TokenCounts} */
export function noTokens() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 };
}

/** @param {TokenCounts} total @param {TokenCounts} one */
function sum(total, one) {
  total.input += one.input;
  total.output += one.output;
  total.cacheRead += one.cacheRead;
  total.cacheWrite += one.cacheWrite;
  total.cacheWrite1h += one.cacheWrite1h;
}

/**
 * A thrown error's name and a short scrubbed message, for a call that got no status. The message is the runtime's own,
 * not the provider's, which is never logged.
 * @param {unknown} error
 * @returns {{ errorName: string; errorMessage: string }}
 */
export function thrown(error) {
  const e = /** @type {any} */ (error);
  return {
    errorName: String(e?.name ?? typeof error).slice(0, 64),
    errorMessage: scrubText(String(e?.message ?? "")).slice(0, 200),
  };
}

/** @param {unknown} error */
export function isAbort(error) {
  const name = /** @type {any} */ (error)?.name;
  return name === "AbortError" || name === "TimeoutError";
}
