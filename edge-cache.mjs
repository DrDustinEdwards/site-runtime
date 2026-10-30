/**
 * A public page stored at the edge by the Workers cache, and purged by tag when the site writes. The scheme
 * dustinedwards.info runs, for every site: the Worker's default export is a gateway with cache disabled, which calls a
 * cacheable entrypoint (`ctx.exports.Renderer`) with `cf: { cacheKey: cacheKey(url) }`; the Renderer's responses are
 * stored. wrangler config: `"cache": { "enabled": true }` and
 * `"exports": { "default": { "type": "worker", "cache": { "enabled": false } }, "Renderer": { "type": "worker", "cache": { "enabled": true } } }`.
 *
 * A stored page is handed to every reader, so it must be the same for all of them: no per-request CSP nonce (trust its
 * inline scripts by hash), no cookie, nothing signed in. Signed-in pages keep the default, `private, no-store`.
 */

/** Stored at the edge, never in a browser: a purge cannot reach a browser, so max-age stays 0. */
export const SHARED_CACHE_CONTROL = "public, max-age=0";

/** The default for anything a route does not mark shared. Omitting Cache-Control is not opting out: the platform caches heuristically. */
export const UNCACHED = "private, no-store";

/** Outranks Cache-Control at Cloudflare's edge, so it goes only on a response marked shared. */
export const EDGE_CACHE_HEADER = "Cloudflare-CDN-Cache-Control";

/** The tag a page carries when the route names none, and the one `purgeTags` is usually called with. */
export const PAGES_CACHE_TAG = "pages";

/**
 * The headers a route returns to have its page stored. A day fresh, a week served stale while it re-renders: safe
 * because every write purges and every deploy starts cold (the Worker version is in the key unless
 * `cross_version_cache` is on). Sent as `Cloudflare-CDN-Cache-Control`, never `s-maxage`, which implies
 * proxy-revalidate, so Cloudflare would refuse to serve stale.
 * @param {{ tags?: string[], freshSeconds?: number, staleSeconds?: number }} [options]
 */
export function publicPageHeaders({ tags = [PAGES_CACHE_TAG], freshSeconds = 86_400, staleSeconds = 604_800 } = {}) {
  if (!Number.isInteger(freshSeconds) || freshSeconds < 0 || !Number.isInteger(staleSeconds) || staleSeconds < 0) {
    throw new Error("publicPageHeaders: freshSeconds and staleSeconds are whole seconds.");
  }
  for (const tag of tags) {
    if (!/^[\x21-\x2b\x2d-\x7e]+$/.test(tag)) throw new Error(`publicPageHeaders: tag "${tag}" holds a comma, a space or a non-ASCII character.`);
  }
  return {
    "Cache-Control": SHARED_CACHE_CONTROL,
    [EDGE_CACHE_HEADER]: `max-age=${freshSeconds}, stale-while-revalidate=${staleSeconds}`,
    "Cache-Tag": tags.join(","),
  };
}

/** The Renderer's cache key: the path and query. A custom `cf.cacheKey` replaces the platform's own path and query. */
export function cacheKey(url) {
  const u = typeof url === "string" ? new URL(url) : url;
  return `${u.pathname}${u.search}`;
}

/**
 * Run in the Renderer on every response, last. Anything not marked shared, and anything but a 200 (an error page
 * rendered under a shared route's headers), is sent `private, no-store` with no edge header, so it is stored nowhere.
 * Returns the response, rebuilt when its headers are immutable.
 * @param {Response} response
 */
export function settleCacheHeaders(response) {
  const apply = (headers) => {
    if (!headers.has("Cache-Control") || response.status !== 200) headers.set("Cache-Control", UNCACHED);
    if (headers.get("Cache-Control") !== SHARED_CACHE_CONTROL) headers.delete(EDGE_CACHE_HEADER);
  };
  try {
    apply(response.headers);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    apply(headers);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
}

/**
 * Run in the gateway on what the Renderer returns: a stored page answered to a request that carries a cookie is told
 * `no-store` for the browser, failing closed, so a personalized page can never sit in a browser or proxy cache.
 * @param {Response} response
 * @param {Request} request
 */
export function forReader(response, request) {
  if (response.headers.get("Cache-Control") !== SHARED_CACHE_CONTROL || !request.headers.has("Cookie")) return response;
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", UNCACHED);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * Drops every stored response carrying one of `tags`. Never throws: a failed purge is a stale page until it expires
 * and a log line, not a failed save. `null` when this runtime has no purge (Miniflare), else whether it purged.
 * @param {{ purge?: (o: { tags: string[] }) => Promise<{ success: boolean, errors?: unknown[] }> } | undefined} cache
 *   `cache` from "cloudflare:workers"
 * @param {string[]} tags
 * @param {string} why one phrase naming the write, for the log line
 * @param {(line: string) => void} [log]
 */
export async function purgeTags(cache, tags, why, log = console.error) {
  if (typeof cache?.purge !== "function") return null;
  try {
    const result = await cache.purge({ tags });
    if (result?.success) return true;
    log(JSON.stringify({ alert: "cache-purge-refused", why, tags, errors: result?.errors ?? [] }));
  } catch (error) {
    log(JSON.stringify({ alert: "cache-purge-threw", why, tags, detail: String(error) }));
  }
  return false;
}
