/**
 * The cross-site check on a request that changes something, for the routes no framework check covers, and an opt-in
 * resource isolation policy for signed-in routes.
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
 * - Fetch Metadata comes first (OWASP CSRF Prevention Cheat Sheet, "Fetch Metadata headers"): a browser that sends
 *   Sec-Fetch-Site says outright whether the request came from this origin, and a page cannot forge it. The Origin
 *   check is the fallback the cheat sheet calls mandatory, for a browser that sends none.
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

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

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
export function refuseCrossSite(request, headers, { sameSite = false } = {}) {
  if (SAFE_METHODS.has(request.method)) return null;
  const site = request.headers.get("Sec-Fetch-Site");
  const ok = site === null
    ? originVerdict(request.headers.get("Origin"), request.url).ok
    : site === "same-origin" || site === "none" || (sameSite && site === "same-site");
  return ok ? null : originRefusal(headers);
}

/**
 * The resource isolation policy (https://web.dev/articles/fetch-metadata), for a signed-in route that only its own
 * pages should reach: a cross-site page cannot load it as an image or script, frame it as an object, or post to it.
 * Allowed: no Sec-Fetch-Site (an older browser or a non-browser client), same-origin, same-site, none, and a GET
 * navigation that is not into an <object> or <embed>. Run it log-only first (log the verdicts it would refuse), then
 * refuse with originRefusal.
 * @param {Request} request
 * @returns {{ ok: boolean, reason: "no-fetch-metadata" | "same-origin" | "same-site" | "none" | "navigation" | "cross-site" }}
 */
export function isolationVerdict(request) {
  const site = request.headers.get("Sec-Fetch-Site");
  if (site === null) return { ok: true, reason: "no-fetch-metadata" };
  if (site === "same-origin" || site === "same-site" || site === "none") return { ok: true, reason: site };
  const dest = request.headers.get("Sec-Fetch-Dest");
  if (request.headers.get("Sec-Fetch-Mode") === "navigate" && request.method === "GET" && dest !== "object" && dest !== "embed") {
    return { ok: true, reason: "navigation" };
  }
  return { ok: false, reason: "cross-site" };
}
