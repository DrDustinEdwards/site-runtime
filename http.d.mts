/** How long an outbound call may take before timedFetch aborts it (ms). */
export const OUTBOUND_TIMEOUT_MS: number;
/** The caller as a rate-limit key: an IPv4 address, an IPv6 one by its /64, or "unknown" without the header. */
export function clientIp(request: Request): string;
/** An IPv4 address as it is, an IPv6 one as `a-b-c-d/64`, an IPv4-mapped one as its IPv4 address. */
export function ipBucket(ip: string): string;
/** Any method but GET, HEAD and OPTIONS. */
export function isWrite(request: Request): boolean;
/** A plain-text answer, `private, no-store`; `headers` adds or overrides. */
export function textResponse(text: string, status?: number, headers?: HeadersInit): Response;
/** A JSON answer, `private, no-store`; `headers` adds or overrides. */
export function jsonResponse(body: unknown, status?: number, headers?: HeadersInit): Response;
/** A redirect, `private, no-store`; `headers` adds or overrides. */
export function redirectResponse(
  location: string | URL,
  status?: number,
  headers?: HeadersInit,
): Response;
/** A response's Retry-After as whole seconds (delta or HTTP date); null when absent or unreadable. */
export function retryAfterSeconds(headers: Headers): number | null;
/** The media type of a Content-Type value: before the first `;`, trimmed, lowercased; "" for none. */
export function mediaType(value: string | null | undefined): string;
/** br, else gzip, else null: the coding this reader takes, from `request.cf.clientAcceptEncoding` (Cloudflare rewrites the header a Worker sees), else Accept-Encoding; q=0 refuses. */
export function acceptedEncoding(request: Request | undefined): "br" | "gzip" | null;
/** fetch with OUTBOUND_TIMEOUT_MS unless the caller passes its own signal. */
export const timedFetch: typeof fetch;
/** A fetch that also stops when `signal` aborts, keeping the timeout; `fetcher` defaults to timedFetch. */
export function fetchUntil(signal: AbortSignal | undefined, fetcher?: typeof fetch): typeof fetch;
/** True on a Cloudflare Worker Preview (`PREVIEW` is "1"). */
export function isWorkerPreview(env: { PREVIEW?: string }): boolean;
/** `PUBLIC_ORIGIN` when set, else the canonical origin, as an origin. */
export function publicOrigin(env: { PUBLIC_ORIGIN?: string }, canonical: string): string;
