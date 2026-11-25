/** One Messages request over the wire: the checks, headers, deadline, cache default and retries (see anthropic.mjs). */

import { retryAfterSeconds } from "./http.mjs";
import { idleTimer } from "./anthropic-stream.mjs";
import { modelEntry } from "./anthropic-models.mjs";
import { failure, isAbort, noTokens, thrown } from "./anthropic-result.mjs";

/** @import { AnthropicEnv, CallOptions, Usage } from "./anthropic.mjs" */

const ANTHROPIC_ORIGIN = "https://api.anthropic.com";
export const ANTHROPIC_VERSION = "2026-10-21";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_PAUSES = 3;
const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 8_000;
const RETRY_STATUS = new Set([500, 504, 529]);
const SAMPLING = ["temperature", "top_p", "top_k"];

/**
 * Checks the request and fixes what one call needs: headers, URL, body, deadline and counters.
 * @param {AnthropicEnv} env
 * @param {string} app
 * @param {Record<string, any>} request
 * @param {CallOptions} options
 * @param {boolean} streaming
 */
export function prepare(env, app, request, options, streaming) {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
  if (!request || typeof request.model !== "string" || !request.model)
    throw new TypeError("The request needs a model");
  if (!Number.isInteger(request.max_tokens) || request.max_tokens < 1)
    throw new TypeError("The request needs max_tokens, a positive whole number");
  const sampling = SAMPLING.filter((name) => request[name] !== undefined);
  if (sampling.length)
    throw new TypeError(
      `API version ${ANTHROPIC_VERSION} refuses ${sampling.join(", ")}; leave them out`,
    );
  if (!Array.isArray(request.messages)) throw new TypeError("The request needs messages");

  /** @type {Record<string, string>} */
  const headers = {
    "content-type": "application/json",
    "anthropic-version": ANTHROPIC_VERSION,
    "x-api-key": key,
  };
  if (options.betas?.length) headers["anthropic-beta"] = options.betas.join(",");
  const { stream: _ignored, ...rest } = request;
  /** @type {Record<string, any>} */
  const body = { ...rest, ...(streaming ? { stream: true } : {}) };
  const ttl = cacheFor(request, options.cache);
  if (ttl && body.cache_control === undefined && !hasBreakpoint(request))
    body.cache_control = ttl === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" };

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const started = Date.now();
  return {
    app,
    feature: options.feature,
    model: request.model,
    url: `${ANTHROPIC_ORIGIN}/v1/messages`,
    headers,
    body,
    streaming,
    timeoutMs,
    deadline: started + timeoutMs,
    started,
    maxAttempts: Math.max(1, options.maxAttempts ?? DEFAULT_ATTEMPTS),
    maxPauses: Math.max(0, options.maxPauses ?? DEFAULT_PAUSES),
    // Wrapped: a bare `fetch` called with this object as `this` is refused by workerd ("Illegal invocation").
    fetcher: options.fetcher ?? ((input, init) => fetch(input, init)),
    sleep: options.sleep ?? defaultSleep,
    signal: options.signal,
    aborted: () => options.signal?.aborted === true,
    log: options.log !== false,
    onResult: options.onResult,
    attempts: 0,
    /** @type {Usage} */
    usage: { ...noTokens(), long: noTokens() },
  };
}

/**
 * The cache setting for this request: the caller's, or automatic when the system prompt, tools and messages together
 * reach the model's minimum.
 * @param {Record<string, any>} request
 * @param {boolean | "1h" | undefined} cache
 * @returns {false | "5m" | "1h"}
 */
function cacheFor(request, cache) {
  if (cache === false) return false;
  if (cache === "1h") return "1h";
  if (cache === true) return "5m";
  const chars = (/** @type {unknown} */ part) =>
    typeof part === "string" ? part.length : part == null ? 0 : JSON.stringify(part).length;
  const min = modelEntry(request.model)?.cacheMin ?? 1024;
  return (chars(request.system) + chars(request.tools) + chars(request.messages)) / 4 >= min
    ? "5m"
    : false;
}

/** Whether any system, tool or message block already carries its own `cache_control`.
 * @param {Record<string, any>} request
 */
function hasBreakpoint(request) {
  const list = (/** @type {unknown} */ value) => (Array.isArray(value) ? value : []);
  const blocks = [
    ...list(request.system),
    ...list(request.tools),
    ...list(request.messages).flatMap((m) => list(m?.content)),
  ];
  return blocks.some((block) => block?.cache_control != null);
}

/** Waits `ms`, or less when `signal` aborts.
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
function defaultSleep(ms, signal) {
  return scheduler.wait(ms, { signal }).catch(() => {});
}

/** A retry's wait, cut short by the caller's abort. False when it was.
 * @param {ReturnType<typeof prepare>} call
 * @param {number} ms
 */
async function wait(call, ms) {
  const signal = call.signal;
  if (!signal) await call.sleep(ms);
  else if (!signal.aborted) {
    /** @type {() => void} */
    let stop = () => {};
    const aborted = new Promise((resolve) =>
      signal.addEventListener("abort", (stop = () => resolve(undefined)), { once: true }),
    );
    await Promise.race([call.sleep(ms, signal), aborted]);
    signal.removeEventListener("abort", stop);
  }
  return !call.aborted();
}

/** Sends one request, retrying as the module comment says: the parsed message, or (streaming) the open response with its idle timer.
 * @param {ReturnType<typeof prepare>} call
 * @param {Record<string, any>} body
 * @returns {Promise<any>}
 */
export async function send(call, body) {
  for (;;) {
    call.attempts++;
    const remaining = call.deadline - Date.now();
    if (remaining <= 0) return failure("timeout", {});
    const idle = call.streaming
      ? idleTimer(call.timeoutMs, Math.min(call.timeoutMs, remaining))
      : null;
    const signals = [
      call.streaming ? /** @type {any} */ (idle).signal : AbortSignal.timeout(remaining),
    ];
    if (call.signal) signals.push(call.signal);
    /** @type {Response} */
    let response;
    /** @type {any} */
    let parsed = null;
    try {
      response = await call.fetcher(call.url, {
        method: "POST",
        headers: call.headers,
        body: JSON.stringify(body),
        signal: AbortSignal.any(signals),
      });
      if (!response.ok) parsed = await response.json().catch(() => null);
      else if (!call.streaming) parsed = await response.json();
    } catch (error) {
      idle?.stop();
      if (call.aborted()) return failure("aborted", {});
      if (isAbort(error) && !call.streaming) return failure("timeout", {});
      const pause = backoff(call.attempts);
      if (call.attempts < call.maxAttempts && Date.now() + pause < call.deadline) {
        if (!(await wait(call, pause))) return failure("aborted", {});
        continue;
      }
      return failure(isAbort(error) ? "timeout" : "unavailable", thrown(error));
    }
    const requestId = response.headers.get("request-id") ?? parsed?.request_id ?? null;
    if (response.ok) {
      if (call.streaming) {
        /** @type {any} */ (idle).touch();
        return { ok: true, response, idle, requestId };
      }
      return { ok: true, message: parsed ?? {}, requestId };
    }
    idle?.stop();
    const decision = retryDecision(response.status, response.headers, parsed, call.attempts);
    if (
      decision.retry &&
      call.attempts < call.maxAttempts &&
      Date.now() + decision.waitMs < call.deadline
    ) {
      if (!(await wait(call, decision.waitMs))) return failure("aborted", {});
      continue;
    }
    const providerType =
      typeof parsed?.error?.type === "string" ? parsed.error.type.slice(0, 64) : undefined;
    return failure(decision.kind, {
      status: response.status,
      requestId,
      providerType,
      retryAfter: decision.retryAfter,
    });
  }
}

/**
 * Whether a failed response is worth another attempt, and after how long.
 * @param {number} status
 * @param {Headers} headers
 * @param {any} body
 * @param {number} attempt
 * @returns {{ kind: string; retry: boolean; waitMs: number; retryAfter?: number }}
 */
function retryDecision(status, headers, body, attempt) {
  if (status === 429) {
    if (body?.error?.details?.error_code === "enforced_spend_limit_reached")
      return { kind: "spend_limit", retry: false, waitMs: 0 };
    const seconds = retryAfterSeconds(headers);
    if (seconds === null) return { kind: "rate_limited", retry: false, waitMs: 0 };
    return { kind: "rate_limited", retry: true, waitMs: seconds * 1000, retryAfter: seconds };
  }
  if (
    status === 400 &&
    String(body?.error?.message ?? "").startsWith("You have reached your specified")
  ) {
    return { kind: "spend_limit", retry: false, waitMs: 0 };
  }
  if (RETRY_STATUS.has(status))
    return { kind: "unavailable", retry: true, waitMs: backoff(attempt) };
  return { kind: status >= 500 ? "unavailable" : "rejected", retry: false, waitMs: 0 };
}

/** Exponential backoff with jitter: half the step plus up to half again, the step doubling from 0.5 s to 8 s. @param {number} attempt */
function backoff(attempt) {
  const step = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
  return Math.round(step / 2 + Math.random() * (step / 2));
}
