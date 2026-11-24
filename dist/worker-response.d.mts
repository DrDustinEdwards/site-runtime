/** The gateway's response helpers, used only by ./worker. */
/**
 * @param {Request} request
 * @param {readonly string[]} publicCookies
 * @returns {Record<string, string> | null} the public cookies' values, or null when any other cookie is present
 */
export function publicCookieValues(request: Request, publicCookies: readonly string[]): Record<string, string> | null;
/**
 * Under `vite dev` only: Vite's client injects each stylesheet as a <style> and takes its nonce from
 * `<meta property="csp-nonce">` (vite.dev/guide/features#content-security-policy-csp).
 * @param {Response} page
 * @param {string} nonce
 */
export function withViteNonce(page: Response, nonce: string): Response;
/**
 * The nonce goes in the policy of a page only: a stored feed or sitemap would hand every reader the same value.
 * @param {Response} response
 * @param {string} nonce
 */
export function pageNonce(response: Response, nonce: string): string | undefined;
/** @param {Response} page */
export function withSpeculationRules(page: Response): Response;
/**
 * A page or step answer drawn for one reader, never stored: an answer with no Cache-Control is said to be private
 * rather than left to a heuristic (RFC 9111 4.2.2).
 * @param {Response} answer
 */
export function forOneReader(answer: Response): Response;
