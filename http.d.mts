/** How long an outbound call may take before timedFetch aborts it (ms). */
export const OUTBOUND_TIMEOUT_MS: number;
/** `cf-connecting-ip`, or "unknown" (one shared bucket) when the edge set none. */
export function clientIp(request: Request): string;
/** Any method but GET, HEAD and OPTIONS. */
export function isWrite(request: Request): boolean;
/** A plain-text answer, `private, no-store`; `headers` adds or overrides. */
export function textResponse(text: string, status?: number, headers?: HeadersInit): Response;
/** A JSON answer, `private, no-store`; `headers` adds or overrides. */
export function jsonResponse(body: unknown, status?: number, headers?: HeadersInit): Response;
/** fetch with OUTBOUND_TIMEOUT_MS unless the caller passes its own signal. */
export const timedFetch: typeof fetch;
/** A fetch that also stops when `signal` aborts, keeping the timeout; `fetcher` defaults to timedFetch. */
export function fetchUntil(signal: AbortSignal | undefined, fetcher?: typeof fetch): typeof fetch;
/** True on a Cloudflare Worker Preview (`PREVIEW` is "1"). */
export function isWorkerPreview(env: { PREVIEW?: string }): boolean;
/** `PUBLIC_ORIGIN` when set, else the canonical origin, as an origin. */
export function publicOrigin(env: { PUBLIC_ORIGIN?: string }, canonical: string): string;
