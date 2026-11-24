/**
 * The caller as a rate-limit key: Cloudflare's edge address (`cf-connecting-ip`, set by the edge and never taken from
 * the client), an IPv4 address as it is and an IPv6 one by its /64 (`2001-db8-0-1/64`), since one host is handed a
 * whole /64 and would otherwise get a fresh bucket per address. Without the header (local dev, a test) every caller
 * shares the one key "unknown", so a request with no address fails closed into one bucket rather than minting a fresh
 * identity each time. Not for Turnstile's `remoteip` or anything that needs the address itself.
 * @param {Request} request
 * @returns {string}
 */
export function clientIp(request: Request): string;
/**
 * An IPv4 address as it is; an IPv6 one as its first four groups (`::` expanded, leading zeros dropped) and `/64`,
 * and an IPv4-mapped one (`::ffff:192.0.2.1`) as its IPv4 address. Written with `-`, so a log scrubber that drops
 * `prefix:ip` drops all of it.
 * @param {string} ip
 * @returns {string}
 */
export function ipBucket(ip: string): string;
/**
 * Whether the request can change something: any method but GET, HEAD and OPTIONS.
 * @param {Request} request
 */
export function isWrite(request: Request): boolean;
/**
 * A plain-text answer, `private, no-store`. `headers` adds or overrides.
 * @param {string} text
 * @param {number} [status]
 * @param {HeadersInit} [headers]
 */
export function textResponse(text: string, status?: number, headers?: HeadersInit): Response;
/**
 * A JSON answer, `private, no-store`. `headers` adds or overrides.
 * @param {unknown} body
 * @param {number} [status]
 * @param {HeadersInit} [headers]
 */
export function jsonResponse(body: unknown, status?: number, headers?: HeadersInit): Response;
/**
 * A redirect, `private, no-store` so a move that is undone is not held in a browser. `headers` adds or overrides.
 * @param {string | URL} location
 * @param {number} [status]
 * @param {HeadersInit} [headers]
 */
export function redirectResponse(location: string | URL, status?: number, headers?: HeadersInit): Response;
/**
 * A response's Retry-After as whole seconds (RFC 9110, 10.2.3): delta-seconds or an HTTP date, never negative; null when
 * the header is absent or unreadable.
 * @param {Headers} headers
 * @returns {number | null}
 */
export function retryAfterSeconds(headers: Headers): number | null;
/**
 * The media type of a Content-Type value: what is before the first `;`, trimmed and lowercased; "" for none.
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function mediaType(value: string | null | undefined): string;
/**
 * The coding to compress an answer with for this reader: br, else gzip, else null (RFC 9110 12.5.3; a q of 0 refuses,
 * `*` stands for any coding not named). The reader's own header is `request.cf.clientAcceptEncoding`: Cloudflare
 * rewrites the Accept-Encoding a Worker sees (developers.cloudflare.com/workers/runtime-apis/request/), so read alone it
 * hands br to a reader who takes only gzip.
 * @param {Request | undefined} request
 * @returns {"br" | "gzip" | null}
 */
export function acceptedEncoding(request: Request | undefined): "br" | "gzip" | null;
/**
 * A fetch that also stops when `signal` aborts (a reader who closed the stream, an MCP call canceled), keeping
 * timedFetch's timeout. `fetcher` (default timedFetch) is the fetch underneath.
 * @param {AbortSignal | undefined} signal
 * @param {typeof fetch} [fetcher]
 * @returns {typeof fetch}
 */
export function fetchUntil(signal: AbortSignal | undefined, fetcher?: typeof fetch): typeof fetch;
/**
 * True on a Cloudflare Worker Preview, where wrangler's `previews.vars.PREVIEW` is "1". Production carries "" or no
 * value. (Not Carrel's /preview links, which share the word.)
 * @param {{ PREVIEW?: string }} env
 */
export function isWorkerPreview(env: {
    PREVIEW?: string;
}): boolean;
/**
 * The origin the site is served at today, for what tells another site about a page (IndexNow, webmentions, Carrel's
 * links): the `PUBLIC_ORIGIN` var when set (a site still on workers.dev before its cutover), else `canonical`, the
 * production origin canonicals and the sitemap always name.
 * @param {{ PUBLIC_ORIGIN?: string }} env
 * @param {string} canonical
 */
export function publicOrigin(env: {
    PUBLIC_ORIGIN?: string;
}, canonical: string): string;
/**
 * The small request and response helpers every site's Worker needs, once: who is asking, whether it writes, the plain
 * answers that are never cached, the outbound fetch that cannot hang, and whether this is a Worker Preview.
 */
/** How long an outbound call may take before timedFetch aborts it (ms). */
export const OUTBOUND_TIMEOUT_MS: 20000;
/**
 * fetch with a timeout: a hung upstream would otherwise hold the request, or a cron run, until the runtime cuts it
 * off. A caller's own signal wins.
 * @type {typeof fetch}
 */
export const timedFetch: typeof fetch;
