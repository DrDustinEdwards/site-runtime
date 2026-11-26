/**
 * A finished message as an answer or a typed failure, by its stop_reason.
 * @param {any} message
 * @returns {RawResult}
 */
export function stopped(message: any): RawResult;
/**
 * @param {string} kind
 * @param {Record<string, unknown>} fields
 * @returns {RawResult}
 */
export function failure(kind: string, fields: Record<string, unknown>): RawResult;
/** Adds a response's usage to the call's running totals.
 * @param {Usage} total
 * @param {any} usage
 * @param {string} model
 */
export function add(total: Usage, usage: any, model: string): void;
/** @returns {TokenCounts} */
export function noTokens(): TokenCounts;
/**
 * A thrown error's name and a short scrubbed message, for a call that got no status. The message is the runtime's own,
 * not the provider's, which is never logged.
 * @param {unknown} error
 * @returns {{ errorName: string; errorMessage: string }}
 */
export function thrown(error: unknown): {
    errorName: string;
    errorMessage: string;
};
/** @param {unknown} error */
export function isAbort(error: unknown): boolean;
/** @import { RawResult, TokenCounts, Usage } from "./anthropic.mjs" */
/** What a reader may be shown for each kind of failure. */
export const FAILURE_TEXT: Readonly<{
    truncated: "The answer was cut off before it finished.";
    context_window: "The request was too long for the assistant to answer.";
    refusal: "The assistant declined to answer this request.";
    paused: "The answer took too many steps to finish.";
    unexpected_stop: "The answer did not finish normally.";
    invalid_output: "The answer was not in the expected form.";
    spend_limit: "AI features are paused for now.";
    rate_limited: "The AI service is busy. Try again in a moment.";
    unavailable: "The AI service is unavailable right now. Try again in a moment.";
    timeout: "The AI service took too long to answer. Try again in a moment.";
    aborted: "The request was canceled.";
    rejected: "The AI request could not be made.";
}>;
import type { RawResult } from "./anthropic.mjs";
import type { Usage } from "./anthropic.mjs";
import type { TokenCounts } from "./anthropic.mjs";
