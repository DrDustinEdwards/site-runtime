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

/**
 * Whether a path is on a list: an exact path, a prefix written with a trailing `*`, or a RegExp. A trailing slash is
 * ignored on both sides, so `/old/` and `/old` are one entry.
 * @param {string} pathname
 * @param {readonly (string | RegExp)[]} list
 */
export function pathListed(pathname, list) {
  const path = pathname === "/" ? "/" : pathname.replace(/\/+$/, "");
  return list.some((entry) => {
    if (entry instanceof RegExp) return entry.test(path);
    if (entry.endsWith("*")) return path.startsWith(entry.slice(0, -1));
    return path === (entry === "/" ? "/" : entry.replace(/\/+$/, ""));
  });
}

/** What a 410 says when the site has no page of its own for it: Capsomer's error page's words. */
const GONE_TEXT = "This page is gone. It was taken down on purpose and is not coming back.\n";

/**
 * 410 Gone for a page removed on purpose, so a crawler drops it sooner than a 404 and a reader is told it is not a typo.
 * `gone` is the site's list (`pathListed`). Null when the path is not on it. A site that renders its own 410 page tests
 * `pathListed` and throws its own 410 instead.
 * @param {Request} request
 * @param {readonly (string | RegExp)[]} gone
 * @param {{ body?: BodyInit | null, contentType?: string }} [options]
 * @returns {Response | null}
 */
export function goneResponse(request, gone, { body = GONE_TEXT, contentType = "text/plain; charset=utf-8" } = {}) {
  if (!pathListed(new URL(request.url).pathname, gone)) return null;
  return new Response(request.method === "HEAD" ? null : body, { status: 410, headers: { "Content-Type": contentType } });
}

/** A rename chain longer than this is a loop. */
const MAX_RENAMES = 10;

/**
 * A 301 (308 for a method other than GET and HEAD) from a renamed slug to its new one under the same `prefix`, keeping
 * what follows the slug and the query: `/blog/old/comments?page=2` to `/blog/new/comments?page=2`. `renames` is the
 * site's table (old slug to new) or a lookup, which may be async and return null for a slug never renamed. A chain
 * (a to b, b to c) is followed to its end, so the reader takes one hop; a loop throws. Null when nothing matches.
 * Sent `private, no-store`, so a rename that is undone is not held in a browser. The Location is on the request's own
 * origin.
 * @param {Request} request
 * @param {{ prefix: string, renames: Readonly<Record<string, string>> | ((slug: string) => string | null | undefined | Promise<string | null | undefined>) }} options
 * @returns {Promise<Response | null>}
 */
export async function renameRedirect(request, { prefix, renames }) {
  if (!prefix.startsWith("/") || !prefix.endsWith("/")) throw new Error(`renameRedirect: prefix starts and ends with "/", not ${JSON.stringify(prefix)}`);
  const url = new URL(request.url);
  if (!url.pathname.startsWith(prefix)) return null;
  const rest = url.pathname.slice(prefix.length);
  const cut = rest.indexOf("/");
  const slug = cut === -1 ? rest : rest.slice(0, cut);
  const suffix = cut === -1 ? "" : rest.slice(cut);
  const lookup = typeof renames === "function" ? renames : (/** @type {string} */ s) => (Object.hasOwn(renames, s) ? renames[s] : null);
  let to = slug;
  for (let hops = 0; ; hops++) {
    const next = slug === "" ? null : await lookup(to);
    if (!next || next === to) break;
    if (hops === MAX_RENAMES) throw new Error(`renameRedirect: the renames from ${JSON.stringify(slug)} loop`);
    to = next;
  }
  if (to === slug) return null;
  const target = new URL(url.origin);
  target.pathname = `${prefix}${encodeURIComponent(to)}${suffix}`;
  target.search = url.search;
  const status = request.method === "GET" || request.method === "HEAD" ? 301 : 308;
  return new Response(null, { status, headers: { Location: target.href, "Cache-Control": "private, no-store" } });
}
