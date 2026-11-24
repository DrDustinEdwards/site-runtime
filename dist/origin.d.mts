/**
 * @param {string | null | undefined} origin the Origin header, verbatim
 * @param {string} requestUrl the request's own URL
 * @returns {{ ok: boolean, reason: "absent" | "same-origin" | "cross-origin" | "unparseable-request-url" }}
 */
export function originVerdict(origin: string | null | undefined, requestUrl: string): {
    ok: boolean;
    reason: "absent" | "same-origin" | "cross-origin" | "unparseable-request-url";
};
/**
 * The 403 a refused request gets: plain text, `no-store` (a cacheable refusal is a refusal served to somebody else).
 * @param {Record<string, string>} [headers] added to the response's, such as the site's security headers
 * @returns {Response}
 */
export function originRefusal(headers?: Record<string, string>): Response;
/**
 * For an admin or resource route: null when the request may go on, else the refusal to return. A GET, HEAD or OPTIONS
 * goes on. Any other method goes on when Sec-Fetch-Site is `same-origin` or `none` (the reader's own action), or
 * `same-site` with `sameSite: true` (a sibling subdomain the site trusts); `cross-site`, `same-site` otherwise and any
 * unknown value are refused. With no Sec-Fetch-Site it is originVerdict's call.
 * @param {Request} request
 * @param {Record<string, string>} [headers] added to the refusal
 * @param {{ sameSite?: boolean }} [options]
 * @returns {Response | null}
 */
export function refuseCrossSite(request: Request, headers?: Record<string, string>, { sameSite }?: {
    sameSite?: boolean;
}): Response | null;
/**
 * The resource isolation policy (https://web.dev/articles/fetch-metadata), for a signed-in route that only its own
 * pages should reach: a cross-site page cannot load it as an image or script, frame it as an object, or post to it.
 * Allowed: no Sec-Fetch-Site (an older browser or a non-browser client), same-origin, same-site, none, and a GET
 * navigation that is not into an <object> or <embed>. Run it log-only first (log the verdicts it would refuse), then
 * refuse with originRefusal.
 * @param {Request} request
 * @returns {{ ok: boolean, reason: "no-fetch-metadata" | "same-origin" | "same-site" | "none" | "navigation" | "cross-site" }}
 */
export function isolationVerdict(request: Request): {
    ok: boolean;
    reason: "no-fetch-metadata" | "same-origin" | "same-site" | "none" | "navigation" | "cross-site";
};
/** The refusal's text. */
export const ORIGIN_REFUSAL: "Cross-origin requests are not accepted.";
