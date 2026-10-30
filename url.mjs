/**
 * One address per page: `/x/` answers with a permanent redirect to `/x`, its query kept, so a page is not indexed,
 * cached and counted twice.
 *
 * - "/" is never redirected, nor a path in `except` (an exact path, or a prefix written with a trailing `*`).
 * - Every trailing slash goes (`/x///` to `/x`).
 * - GET and HEAD get 301; any other method 308, so a form body survives the redirect.
 * - The Location is absolute and on the request's own origin, so a path such as `//attacker.example/` can never become
 *   a protocol-relative redirect off the site.
 */

/**
 * The redirect for a path that ends in a slash, or null when there is nothing to redirect.
 * @param {Request} request
 * @param {{ except?: readonly string[] }} [options]
 * @returns {Response | null}
 */
export function slashRedirect(request, { except = [] } = {}) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === "/" || !path.endsWith("/")) return null;
  if (except.some((entry) => (entry.endsWith("*") ? path.startsWith(entry.slice(0, -1)) : path === entry))) return null;
  const trimmed = path.replace(/\/+$/, "");
  if (trimmed === "") return null;
  // Rebuilt from the origin, so a leading "//" stays a path: new URL keeps the host whatever the path holds.
  const target = new URL(url.origin);
  target.pathname = trimmed.replace(/^\/+/, "/");
  target.search = url.search;
  const status = request.method === "GET" || request.method === "HEAD" ? 301 : 308;
  return new Response(null, { status, headers: { Location: target.href } });
}
