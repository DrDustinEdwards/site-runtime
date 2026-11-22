import { SHARED_CACHE_CONTROL, privateRender } from "./edge-cache.mjs";
import { cookiePairs } from "./headers.mjs";
import { SPECULATION_RULES_HEADER } from "./prefetch.mjs";

/** The gateway's response helpers, used only by ./worker. */

/**
 * @param {Request} request
 * @param {readonly string[]} publicCookies
 * @returns {Record<string, string> | null} the public cookies' values, or null when any other cookie is present
 */
export function publicCookieValues(request, publicCookies) {
  /** @type {Record<string, string>} */
  const values = {};
  for (const [name, value] of cookiePairs(request)) {
    if (!publicCookies.includes(name)) return null;
    values[name] = value;
  }
  return values;
}

/**
 * Under `vite dev` only: Vite's client injects each stylesheet as a <style> and takes its nonce from
 * `<meta property="csp-nonce">` (vite.dev/guide/features#content-security-policy-csp).
 * @param {Response} page
 * @param {string} nonce
 */
export function withViteNonce(page, nonce) {
  if (!page.headers.get("Content-Type")?.startsWith("text/html")) return page;
  return new HTMLRewriter()
    .on("head", {
      element: (head) =>
        void head.prepend(`<meta property="csp-nonce" nonce="${nonce}">`, { html: true }),
    })
    .transform(page);
}

/**
 * The nonce goes in the policy of a page only: a stored feed or sitemap would hand every reader the same value.
 * @param {Response} response
 * @param {string} nonce
 */
export function pageNonce(response, nonce) {
  return response.headers.get("Content-Type")?.startsWith("text/html") ? nonce : undefined;
}

/** @param {Response} page */
export function withSpeculationRules(page) {
  if (!page.headers.get("Content-Type")?.startsWith("text/html")) return page;
  if (page.headers.get(SPECULATION_RULES_HEADER.name) === SPECULATION_RULES_HEADER.value)
    return page;
  // A stored or fetched response's headers can be immutable, so the header goes on a copy.
  const headers = new Headers(page.headers);
  headers.set(SPECULATION_RULES_HEADER.name, SPECULATION_RULES_HEADER.value);
  return new Response(page.body, { status: page.status, statusText: page.statusText, headers });
}

/**
 * A page or step answer drawn for one reader, never stored: an answer with no Cache-Control is said to be private
 * rather than left to a heuristic (RFC 9111 4.2.2).
 * @param {Response} answer
 */
export function forOneReader(answer) {
  const cacheControl = answer.headers.get("Cache-Control");
  return !cacheControl || cacheControl === SHARED_CACHE_CONTROL ? privateRender(answer) : answer;
}
