/**
 * The same-origin check on a request that changes something, for the routes no framework check covers.
 *
 * React Router checks the Origin of a document's action submission, but a resource route (a route with no default
 * export: an API endpoint, a form post answered with a redirect, an admin JSON route) never reaches that check, and a
 * Worker route outside React Router has none at all. dustinedwards.info's admin middleware and theme route found that
 * gap; this is their check, shared.
 *
 * - An absent Origin passes: only non-browser clients and a no-script same-site form post omit it, and a hostile page
 *   cannot make a browser leave it out. A non-browser client spends its own address's rate allowance.
 * - The string "null" (a sandboxed frame, an opaque origin) is refused, unlike a missing header.
 * - The Origin is compared with the request's own origin, not a configured one, so the check holds on workers.dev, a
 *   preview and the live domain alike.
 * - The refusal says nothing about what the route does or why it refused, and is never cached.
 */

/** The refusal's text. */
export const ORIGIN_REFUSAL = "Cross-origin requests are not accepted.";

/**
 * @param {string | null | undefined} origin the Origin header, verbatim
 * @param {string} requestUrl the request's own URL
 * @returns {{ ok: boolean, reason: "absent" | "same-origin" | "cross-origin" | "unparseable-request-url" }}
 */
export function originVerdict(origin, requestUrl) {
  if (origin === null || origin === undefined || origin === "") return { ok: true, reason: "absent" };
  let self;
  try {
    self = new URL(requestUrl).origin;
  } catch {
    return { ok: false, reason: "unparseable-request-url" };
  }
  return origin === self ? { ok: true, reason: "same-origin" } : { ok: false, reason: "cross-origin" };
}

/**
 * The 403 a refused request gets: plain text, `no-store` (a cacheable refusal is a refusal served to somebody else).
 * @param {Record<string, string>} [headers] added to the response's, such as the site's security headers
 * @returns {Response}
 */
export function originRefusal(headers = {}) {
  return new Response(ORIGIN_REFUSAL, {
    status: 403,
    headers: { ...headers, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/**
 * For an admin or resource route: null when the request may go on (a GET, HEAD or OPTIONS, or any request whose
 * Origin passes), else the refusal to return.
 * @param {Request} request
 * @param {Record<string, string>} [headers] added to the refusal
 * @returns {Response | null}
 */
export function refuseCrossOrigin(request, headers) {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return null;
  return originVerdict(request.headers.get("Origin"), request.url).ok ? null : originRefusal(headers);
}
