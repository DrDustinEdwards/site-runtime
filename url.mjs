/**
 * One address per page: `/x/` answers with a permanent redirect to `/x`, its query kept, so a page is not indexed,
 * cached and counted twice. `canonicalRedirect` also moves plaintext to https and `www.` to the bare host, all in the
 * one hop, so `http://www.example.com/x/` reaches `https://example.com/x` with a single redirect.
 *
 * - "/" is never redirected, nor a path in `except` (an exact path, or a prefix written with a trailing `*`).
 * - Every trailing slash goes (`/x///` to `/x`).
 * - GET and HEAD get 301; any other method 308, so a form body survives the redirect.
 * - The Location is absolute and on the request's own origin, so a path such as `//attacker.example/` can never become
 *   a protocol-relative redirect off the site.
 * - Never stored: the edge key holds no scheme, so a stored redirect would send https readers back to themselves.
 */

/** The dev server and wrangler serve plaintext; redirecting them breaks local dev. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The redirect for a path that ends in a slash, or null when there is nothing to redirect.
 * @param {Request} request
 * @param {{ except?: readonly string[] }} [options]
 * @returns {Response | null}
 */
export function slashRedirect(request, { except = [] } = {}) {
  return canonicalRedirect(request, { except, https: false });
}

/**
 * The one redirect to the page's canonical address: https (unless `https` is false or the host is loopback), `host`
 * for `www.<host>` when `host` is given, and no trailing slash. Null when the request is already there.
 * @param {Request} request
 * @param {{ host?: string, except?: readonly string[], https?: boolean }} [options]
 * @returns {Response | null}
 */
export function canonicalRedirect(request, { host, except = [], https = true } = {}) {
  const url = new URL(request.url);
  const local = LOOPBACK.has(url.hostname) || url.hostname.endsWith(".localhost");
  const scheme = https && !local && url.protocol === "http:" ? "https:" : url.protocol;
  const hostname = host && url.hostname === `www.${host}` ? host : url.hostname;
  let path = url.pathname;
  const kept = except.some((entry) => (entry.endsWith("*") ? path.startsWith(entry.slice(0, -1)) : path === entry));
  if (path !== "/" && path.endsWith("/") && !kept) path = path.replace(/\/+$/, "") || "/";
  if (scheme === url.protocol && hostname === url.hostname && path === url.pathname) return null;
  // Rebuilt from the origin, so a leading "//" stays a path: new URL keeps the host whatever the path holds.
  const target = new URL(`${scheme}//${hostname}${url.port ? `:${url.port}` : ""}`);
  target.pathname = path.replace(/^\/+/, "/");
  target.search = url.search;
  const status = request.method === "GET" || request.method === "HEAD" ? 301 : 308;
  return new Response(null, { status, headers: { Location: target.href, "Cache-Control": "private, no-store" } });
}
