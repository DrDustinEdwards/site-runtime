/** The cross-site check on a request that changes something, and the opt-in resource isolation policy (origin.mjs). */

/** "Cross-origin requests are not accepted." */
export const ORIGIN_REFUSAL: string;
/** An absent Origin passes, the same origin passes, anything else (the string "null" included) is refused. */
export function originVerdict(
  origin: string | null | undefined,
  requestUrl: string,
): { ok: boolean; reason: "absent" | "same-origin" | "cross-origin" | "unparseable-request-url" };
/** The 403 plain-text refusal, `no-store`, with `headers` added. */
export function originRefusal(headers?: Record<string, string>): Response;
/**
 * Null when the request may go on (GET, HEAD, OPTIONS; Sec-Fetch-Site same-origin or none, or same-site with
 * `sameSite: true`; with no Sec-Fetch-Site, an Origin that passes), else the refusal.
 */
export function refuseCrossSite(request: Request, headers?: Record<string, string>, options?: { sameSite?: boolean }): Response | null;
/** The older name of refuseCrossSite. */
export const refuseCrossOrigin: typeof refuseCrossSite;
/** The resource isolation policy (web.dev/articles/fetch-metadata) for signed-in routes. */
export function isolationVerdict(request: Request): {
  ok: boolean;
  reason: "no-fetch-metadata" | "same-origin" | "same-site" | "none" | "navigation" | "cross-site";
};
