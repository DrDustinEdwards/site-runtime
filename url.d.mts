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

/** Whether a path is on a list: exact, a prefix ending in `*`, or a RegExp; a trailing slash is ignored. */
export function pathListed(pathname: string, list: readonly (string | RegExp)[]): boolean;

/** 410 Gone (plain text unless `body` is given) for a path on the site's `gone` list; null otherwise. */
export function goneResponse(request: Request, gone: readonly (string | RegExp)[], options?: { body?: BodyInit | null; contentType?: string }): Response | null;

/**
 * A 301 (308 for other methods) from `<prefix><old slug><rest>` to `<prefix><new slug><rest>`, query kept, a chain
 * followed to its end; null when the slug was never renamed. `renames` is a table or a lookup (sync or async).
 */
export function renameRedirect(
  request: Request,
  options: {
    prefix: string;
    renames: Readonly<Record<string, string>> | ((slug: string) => string | null | undefined | Promise<string | null | undefined>);
  },
): Promise<Response | null>;
