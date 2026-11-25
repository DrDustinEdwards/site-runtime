/**
 * Checks the request and fixes what one call needs: headers, URL, body, deadline and counters.
 * @param {AnthropicEnv} env
 * @param {string} app
 * @param {Record<string, any>} request
 * @param {CallOptions} options
 * @param {boolean} streaming
 */
export function prepare(env: AnthropicEnv, app: string, request: Record<string, any>, options: CallOptions, streaming: boolean): {
    app: string;
    feature: string | undefined;
    model: string;
    url: string;
    headers: Record<string, string>;
    body: Record<string, any>;
    streaming: boolean;
    timeoutMs: number;
    deadline: number;
    started: number;
    maxAttempts: number;
    maxPauses: number;
    fetcher: typeof fetch;
    sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
    signal: AbortSignal | undefined;
    aborted: () => boolean;
    log: boolean;
    onResult: ((record: import("./anthropic.mjs").CallRecord) => void | Promise<void>) | undefined;
    attempts: number;
    /** @type {Usage} */
    usage: Usage;
};
/** Sends one request, retrying as the module comment says: the parsed message, or (streaming) the open response with its idle timer.
 * @param {ReturnType<typeof prepare>} call
 * @param {Record<string, any>} body
 * @returns {Promise<any>}
 */
export function send(call: ReturnType<typeof prepare>, body: Record<string, any>): Promise<any>;
export const ANTHROPIC_VERSION: "2026-10-21";
import type { AnthropicEnv } from "./anthropic.mjs";
import type { CallOptions } from "./anthropic.mjs";
import type { Usage } from "./anthropic.mjs";
