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

/** The shortest lifetime `until` gives: a time seconds away would make every read until then a render. */
const UNTIL_FLOOR_SECONDS = 60;

/**
 * The headers a route returns to have its page stored. A day fresh, a week served stale while it re-renders: safe
 * because every write purges and every deploy starts cold (the Worker version is in the key unless
 * `cross_version_cache` is on). Sent as `Cloudflare-CDN-Cache-Control`, never `s-maxage`, which implies
 * proxy-revalidate, so Cloudflare would refuse to serve stale. The Workers cache serves the stored page when a
 * re-render fails, with no `stale-if-error` needed. `until` is when the page changes with no write to purge on (the
 * next scheduled post on a page that lists posts): it stays fresh no later than that, and no less than a minute.
 * @param {{ tags?: string[], freshSeconds?: number, staleSeconds?: number, until?: Date | null, now?: Date }} [options]
 */
export function publicPageHeaders({ tags = [PAGES_CACHE_TAG], freshSeconds = 86_400, staleSeconds = 604_800, until = null, now = new Date() } = {}) {
  if (!Number.isInteger(freshSeconds) || freshSeconds < 0 || !Number.isInteger(staleSeconds) || staleSeconds < 0) {
    throw new Error("publicPageHeaders: freshSeconds and staleSeconds are whole seconds.");
  }
  if (until) freshSeconds = Math.min(freshSeconds, Math.max(UNTIL_FLOOR_SECONDS, Math.ceil((until.getTime() - now.getTime()) / 1000)));
  for (const tag of tags) {
    if (!/^[\x21-\x2b\x2d-\x7e]+$/.test(tag)) throw new Error(`publicPageHeaders: tag "${tag}" holds a comma, a space or a non-ASCII character.`);
  }
  return {
    "Cache-Control": SHARED_CACHE_CONTROL,
    [EDGE_CACHE_HEADER]: `max-age=${freshSeconds}, stale-while-revalidate=${staleSeconds}`,
    "Cache-Tag": tags.join(","),
  };
}

/**
 * Query parameters that only say where a reader came from: ad and newsletter click ids and campaign tags. The page is
 * the same with or without them, so they are left out of the key, as WP Rocket and Cloudflare's cache rules do; the
 * Renderer still gets the full URL. `utm_` is a prefix.
 */
export const TRACKING_PARAMS = [
  ...["utm_", "gclid", "gbraid", "wbraid", "dclid", "gad_source", "fbclid", "msclkid", "twclid", "ttclid", "li_fat_id"],
  ...["igshid", "yclid", "mc_cid", "mc_eid", "_ga", "_gl", "_hsenc", "_hsmi", "mkt_tok", "srsltid"],
];

const tracking = (/** @type {string} */ name) => TRACKING_PARAMS.some((t) => (t.endsWith("_") ? name.startsWith(t) : name === t));

/**
 * The Renderer's cache key: the path, then the query without `TRACKING_PARAMS`, sorted so `?a&b` and `?b&a` share one
 * entry. A custom `cf.cacheKey` replaces the platform's own path and query. `dimensions` are what else the page varies
 * by (a theme read from a cookie), each added as `;name=value` after the query.
 * @param {URL | string} url
 * @param {{ dimensions?: Record<string, string | undefined> }} [options]
 */
export function cacheKey(url, { dimensions = {} } = {}) {
  const u = typeof url === "string" ? new URL(url) : url;
  const params = [...u.searchParams].filter(([name]) => !tracking(name));
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const search = params.length ? `?${new URLSearchParams(params)}` : "";
  const extra = Object.entries(dimensions)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `;${name}=${encodeURIComponent(/** @type {string} */ (value))}`)
    .join("");
  return `${u.pathname}${search}${extra}`;
}

/**
 * Run in the Renderer on every response, last. Anything not marked shared, anything but a 200 (an error page rendered
 * under a shared route's headers) and anything setting a cookie is sent `private, no-store` with no edge header or tag,
 * so it is stored nowhere. Pass the request when the Renderer can be reached with a cookie: a page rendered for one is
 * never stored either. A stored page with no validator gets `Last-Modified`, the time it was rendered: it stays the
 * same until a purge or a deploy renders it again, so `forReader` can answer a returning reader 304. Returns the
 * response, rebuilt when its headers are immutable.
 * @param {Response} response
 * @param {Request} [request]
 */
export function settleCacheHeaders(response, request) {
  const personal = response.headers.has("Set-Cookie") || Boolean(request?.headers.has("Cookie"));
  const apply = (/** @type {Headers} */ headers) => {
    if (!headers.has("Cache-Control") || response.status !== 200 || personal) headers.set("Cache-Control", UNCACHED);
    if (headers.get("Cache-Control") !== SHARED_CACHE_CONTROL) {
      headers.delete(EDGE_CACHE_HEADER);
      headers.delete("Cache-Tag");
    } else if (!headers.has("Last-Modified") && !headers.has("ETag")) {
      headers.set("Last-Modified", new Date().toUTCString());
    }
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

/** The names of the cookies in a request's Cookie header. */
const cookieNames = (/** @type {Request} */ request) =>
  (request.headers.get("Cookie") ?? "")
    .split(";")
    .map((pair) => pair.split("=")[0].trim())
    .filter(Boolean);

/**
 * Run in the gateway on what the Renderer returns: a stored page answered to a request that carries a cookie is told
 * `no-store` for the browser, failing closed, so a personalized page can never sit in a browser or proxy cache.
 * `publicCookies` names the cookies that change nothing private (a theme the key already holds): a request carrying
 * only those keeps the shared header, so its pages stay eligible for the back/forward cache. A reader who already holds
 * the page (If-None-Match, If-Modified-Since) gets a 304 with no body.
 * @param {Response} response
 * @param {Request} request
 * @param {{ publicCookies?: readonly string[] }} [options]
 */
export function forReader(response, request, { publicCookies = [] } = {}) {
  if (response.headers.get("Cache-Control") !== SHARED_CACHE_CONTROL) return response;
  if (!cookieNames(request).every((name) => publicCookies.includes(name))) return privateRender(response);
  return notModified(response, request) ?? response;
}

/**
 * The 304 for a reader who already holds this page: its ETag in If-None-Match, or (with no If-None-Match) a
 * Last-Modified no later than If-Modified-Since. Null when the page must be sent. RFC 9110 section 13.
 * @param {Response} response
 * @param {Request} request
 */
function notModified(response, request) {
  if (response.status !== 200 || (request.method !== "GET" && request.method !== "HEAD")) return null;
  const etag = response.headers.get("ETag");
  const ifNoneMatch = request.headers.get("If-None-Match");
  const weak = (/** @type {string} */ tag) => tag.trim().replace(/^W\//, "");
  let fresh = false;
  if (ifNoneMatch) fresh = Boolean(etag) && (ifNoneMatch.trim() === "*" || ifNoneMatch.split(",").some((tag) => weak(tag) === weak(etag)));
  else {
    const since = Date.parse(request.headers.get("If-Modified-Since") ?? "");
    const modified = Date.parse(response.headers.get("Last-Modified") ?? "");
    fresh = !Number.isNaN(since) && !Number.isNaN(modified) && modified <= since;
  }
  if (!fresh) return null;
  const headers = new Headers(response.headers);
  for (const name of ["Content-Length", "Content-Encoding", "Content-Type"]) headers.delete(name);
  response.body?.cancel();
  return new Response(null, { status: 304, headers });
}

/**
 * A page rendered for one reader, on a path that never reaches the Renderer: whatever its route said, it leaves
 * `private, no-store` with no edge header and no tag, so neither the edge nor a browser keeps it.
 * @param {Response} response
 */
export function privateRender(response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", UNCACHED);
  headers.delete(EDGE_CACHE_HEADER);
  headers.delete("Cache-Tag");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * Drops every stored response carrying one of `tags`. Never throws: a failed purge is a stale page until it expires
 * and a log line, not a failed save. `null` when this runtime has no purge (Miniflare), else whether it purged.
 * @param {{ purge?: (o: { tags: string[] }) => Promise<{ success: boolean, errors?: unknown[] }> } | undefined} cache
 *   the Renderer's `this.ctx.cache`: a purge reaches only the cache of the entrypoint that calls it, so one made in the
 *   gateway clears nothing
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

/**
 * The Renderer's `purgePages` RPC method, mixed into its class: `class Renderer extends withPurgePages(WorkerEntrypoint)`.
 * The method drops `tags` (default `PAGES_CACHE_TAG`) from the Renderer's own cache; RPC methods bypass the cache.
 * @template {new (...args: any[]) => { ctx: { cache?: any } }} T
 * @param {T} Base
 */
export function withPurgePages(Base) {
  return class extends Base {
    /** @param {string} why @param {string[]} [tags] */
    async purgePages(why, tags = [PAGES_CACHE_TAG]) {
      return purgeTags(this.ctx.cache, tags, why);
    }
  };
}

const isWrite = (/** @type {Request} */ request) => request.method !== "GET" && request.method !== "HEAD";

/**
 * In the gateway, after it answers a write: an accepted one (below 400) asks the Renderer to purge, in `waitUntil`, so
 * the answer never waits on it. A read or a refused write purges nothing.
 * @param {Request} request
 * @param {Response} response
 * @param {{ waitUntil(p: Promise<unknown>): void, exports: { Renderer: { purgePages(why: string): Promise<unknown> } } }} ctx
 * @param {string} why
 */
export function purgeAfterWrite(request, response, ctx, why) {
  if (isWrite(request) && response.status < 400) ctx.waitUntil(ctx.exports.Renderer.purgePages(why));
}

/**
 * From code with no execution context (a cron, a queue, a site-api schedule): asks the Renderer to purge over the
 * Worker's own loopback, `exports` from "cloudflare:workers", imported when called so Node never loads it. Never
 * throws: `null` when the Renderer cannot be reached (logged), else what its purge returned.
 * @param {string} why
 * @param {(line: string) => void} [log]
 * @returns {Promise<boolean | null>}
 */
export async function purgeViaRenderer(why, log = console.error) {
  try {
    const { exports } = await import(/* @vite-ignore */ "cloudflare:workers");
    return await exports.Renderer.purgePages(why);
  } catch (error) {
    log(JSON.stringify({ alert: "cache-purge-unreachable", why, detail: String(error) }));
    return null;
  }
}

/**
 * A site-api publish hook (its `PublishHook` shape) that purges the stored pages when a schedule changes one: a
 * schedule has no request, so no gateway purges after it. A Carrel request's write is purged by `purgeAfterWrite`.
 * @param {{ purge?: (why: string) => Promise<boolean | null> }} [options] `purgeViaRenderer` unless given
 */
export function schedulePurgeHook({ purge = purgeViaRenderer } = {}) {
  return {
    name: "edge-page-purge",
    /** @param {{ trigger: string, action: string, path: string }} event */
    async run(event) {
      if (event.trigger !== "schedule") return true;
      return (await purge(`schedule ${event.action} ${event.path}`)) !== false;
    },
  };
}
