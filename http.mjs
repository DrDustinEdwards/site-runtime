/**
 * The small request and response helpers every site's Worker needs, once: who is asking, whether it writes, the plain
 * answers that are never cached, the outbound fetch that cannot hang, and whether this is a Worker Preview. Each was a
 * copy in two to seven sites (the 2026-11-11 shared-code audit, item 37).
 */

/** How long an outbound call may take before timedFetch aborts it (ms). */
export const OUTBOUND_TIMEOUT_MS = 20_000;

/**
 * The caller as a rate-limit key: Cloudflare's edge address (`cf-connecting-ip`, set by the edge and never taken from
 * the client), an IPv4 address as it is and an IPv6 one by its /64 (`2001-db8-0-1/64`), since one host is handed a
 * whole /64 and would otherwise get a fresh bucket per address. Without the header (local dev, a test) every caller
 * shares the one key "unknown", so a request with no address fails closed into one bucket rather than minting a fresh
 * identity each time. Not for Turnstile's `remoteip` or anything that needs the address itself.
 * @param {Request} request
 * @returns {string}
 */
export function clientIp(request) {
  const ip = request.headers.get("cf-connecting-ip")?.trim();
  return ip ? ipBucket(ip) : "unknown";
}

/**
 * An IPv4 address as it is; an IPv6 one as its first four groups (`::` expanded, leading zeros dropped) and `/64`,
 * and an IPv4-mapped one (`::ffff:192.0.2.1`) as its IPv4 address. Written with `-`, so a log scrubber that drops
 * `prefix:ip` drops all of it.
 * @param {string} ip
 * @returns {string}
 */
export function ipBucket(ip) {
  const address = ip.toLowerCase().split("%")[0] ?? "";
  if (!address.includes(":")) return address;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (mapped) return /** @type {string} */ (mapped[1]);
  const [head = "", tail] = address.split("::");
  const front = head ? head.split(":") : [];
  const back = tail ? tail.split(":") : [];
  const groups =
    tail === undefined
      ? front
      : [...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill("0"), ...back];
  return `${groups
    .slice(0, 4)
    .map((g) => (Number.parseInt(g, 16) || 0).toString(16))
    .join("-")}/64`;
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
 * A redirect, `private, no-store` so a move that is undone is not held in a browser. `headers` adds or overrides.
 * @param {string | URL} location
 * @param {number} [status]
 * @param {HeadersInit} [headers]
 */
export function redirectResponse(location, status = 302, headers) {
  const out = new Headers(headers);
  if (!out.has("Cache-Control")) out.set("Cache-Control", "private, no-store");
  out.set("Location", String(location));
  return new Response(null, { status, headers: out });
}

/**
 * A response's Retry-After as whole seconds (RFC 9110, 10.2.3): delta-seconds or an HTTP date, never negative; null when
 * the header is absent or unreadable.
 * @param {Headers} headers
 * @returns {number | null}
 */
export function retryAfterSeconds(headers) {
  const raw = headers.get("Retry-After")?.trim() ?? "";
  if (/^\d{1,9}$/.test(raw)) return Number(raw);
  const date = raw ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : null;
}

/**
 * The media type of a Content-Type value: what is before the first `;`, trimmed and lowercased; "" for none.
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function mediaType(value) {
  return (value ?? "").split(";")[0].trim().toLowerCase();
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
 * A fetch that also stops when `signal` aborts (a reader who closed the stream, an MCP call canceled), keeping
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
