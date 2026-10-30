/** One address per page (url.mjs). */

/**
 * A 301 (308 for a method other than GET and HEAD) from `/x/` to `/x` on the request's own origin, query kept; null for
 * "/", a path without a trailing slash, or one in `except` (exact, or a prefix ending in `*`).
 */
export function slashRedirect(request: Request, options?: { except?: readonly string[] }): Response | null;

/**
 * The one redirect to the canonical address: https (unless `https` is false or the host is loopback), `host` for
 * `www.<host>`, no trailing slash. Null when the request is already there. Sent `private, no-store`.
 */
export function canonicalRedirect(request: Request, options?: { host?: string; except?: readonly string[]; https?: boolean }): Response | null;
