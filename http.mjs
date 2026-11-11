/**
 * The small request and response helpers every site's Worker needs, once: who is asking, whether it writes, the plain
 * answers that are never cached, the outbound fetch that cannot hang, and whether this is a Worker Preview. Each was a
 * copy in two to seven sites (the 2026-11-11 shared-code audit, item 37).
 */

/** How long an outbound call may take before timedFetch aborts it (ms). */
export const OUTBOUND_TIMEOUT_MS = 20_000;

/**
 * The caller's address as Cloudflare's edge saw it (`cf-connecting-ip`, set by the edge and never taken from the
 * client), for a rate-limit key. Without it (local dev, a test) every caller shares the one key "unknown", so a
 * request with no address fails closed into one bucket rather than minting a fresh identity each time.
 * @param {Request} request
 * @returns {string}
 */
export function clientIp(request) {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

/**
 * Whether the request can change something: any method but GET, HEAD and OPTIONS.
 * @param {Request} request
 */
export function isWrite(request) {
  return !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase());
}

/**
 * A plain-text answer, `private, no-store`. `headers` adds or overrides.
 * @param {string} text
 * @param {number} [status]
 * @param {HeadersInit} [headers]
 */
export function textResponse(text, status = 200, headers) {
  return neverCached(text, status, "text/plain; charset=utf-8", headers);
}

/**
 * A JSON answer, `private, no-store`. `headers` adds or overrides.
 * @param {unknown} body
 * @param {number} [status]
 * @param {HeadersInit} [headers]
 */
export function jsonResponse(body, status = 200, headers) {
  return neverCached(JSON.stringify(body), status, "application/json; charset=utf-8", headers);
}

/**
 * @param {string} body
 * @param {number} status
 * @param {string} type
 * @param {HeadersInit | undefined} extra
 */
function neverCached(body, status, type, extra) {
  const headers = new Headers({ "Content-Type": type, "Cache-Control": "private, no-store" });
  for (const [name, value] of new Headers(extra)) headers.set(name, value);
  return new Response(body, { status, headers });
}

/**
 * fetch with a timeout: a hung upstream would otherwise hold the request, or a cron run, until the runtime cuts it
 * off. A caller's own signal wins.
 * @type {typeof fetch}
 */
export const timedFetch = (input, init) =>
  fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(OUTBOUND_TIMEOUT_MS) });

/**
 * A fetch that also stops when `signal` aborts (a reader who closed the stream, an MCP call cancelled), keeping
 * timedFetch's timeout. `fetcher` (default timedFetch) is the fetch underneath.
 * @param {AbortSignal | undefined} signal
 * @param {typeof fetch} [fetcher]
 * @returns {typeof fetch}
 */
export function fetchUntil(signal, fetcher = timedFetch) {
  if (!signal) return fetcher;
  return (input, init) =>
    fetcher(input, {
      ...init,
      signal: AbortSignal.any([init?.signal ?? AbortSignal.timeout(OUTBOUND_TIMEOUT_MS), signal]),
    });
}

/**
 * True on a Cloudflare Worker Preview, where wrangler's `previews.vars.PREVIEW` is "1". Production carries "" or no
 * value. (Not Carrel's /preview links, which share the word.)
 * @param {{ PREVIEW?: string }} env
 */
export function isWorkerPreview(env) {
  return env.PREVIEW === "1";
}

/**
 * The origin the site is served at today, for what tells another site about a page (IndexNow, webmentions, Carrel's
 * links): the `PUBLIC_ORIGIN` var when set (a site still on workers.dev before its cutover), else `canonical`, the
 * production origin canonicals and the sitemap always name.
 * @param {{ PUBLIC_ORIGIN?: string }} env
 * @param {string} canonical
 */
export function publicOrigin(env, canonical) {
  return new URL(env.PUBLIC_ORIGIN || canonical).origin;
}
