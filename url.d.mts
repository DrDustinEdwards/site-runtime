/** One address per page (url.mjs). */

/**
 * A 301 (308 for a method other than GET and HEAD) from `/x/` to `/x` on the request's own origin, query kept; null for
 * "/", a path without a trailing slash, or one in `except` (exact, or a prefix ending in `*`).
 */
export function slashRedirect(request: Request, options?: { except?: readonly string[] }): Response | null;
