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

import { acceptedEncoding, isWrite, mediaType } from "./http.mjs";

/** Stored at the edge, never in a browser: a purge cannot reach a browser, so max-age stays 0. */
export const SHARED_CACHE_CONTROL = "public, max-age=0";

/**
 * The default for anything a route does not mark shared. Omitting Cache-Control is not opting out: the platform caches
 * heuristically. A signed-in page keeps it on purpose, though `no-store` costs the back/forward cache in Firefox and
 * Safari ("DON'T use Cache-Control: no-store for non-sensitive resources", Chrome's Modern Web Guidance, performance):
 * such a page is private data, and OWASP ASVS 5.0 (14.3.2) asks that sensitive data not be stored in a browser cache.
 * Chrome stores no-store pages in its back/forward cache since its 2025 rollout, for 3 minutes, evicting one when a
 * cookie changes, so signing out still drops it (developer.chrome.com/docs/web-platform/bfcache-ccns). Public pages
 * are never no-store: publicPageHeaders sends `public, max-age=0`, which every browser's back/forward cache keeps.
 */
export const UNCACHED = "private, no-store";

/**
 * The `headers` of every private page, the network's one definition of one: admin pages, every signed-in page, the
 * sign-in, sign-up and mailed-link confirm pages, account pages, and any page drawn for one reader. UNCACHED
 * plus `no-transform`, so the Web Analytics beacon Cloudflare injects into HTML never reaches it
 * (developers.cloudflare.com/web-analytics/faq/) and only public pages are counted. Cloudflare then compresses nothing
 * (developers.cloudflare.com/cache/concepts/cache-control/), so the Worker does (`compressUntransformed`, which the
 * gateway runs on every answer). It goes on pages, never on assets, which keep the edge's compression and cache.
 */
export const PRIVATE_PAGE_HEADERS = Object.freeze({ "Cache-Control": `${UNCACHED}, no-transform` });

const NO_TRANSFORM = /(?:^|,)\s*no-transform\s*(?:,|$)/i;

/** What compressing pays for: text, JSON, JavaScript, XML and SVG. Images, fonts and media are compressed already. */
const COMPRESSIBLE =
  /^(?:text\/|application\/(?:json|javascript|xml|[\w.-]+\+(?:json|xml))$|image\/svg\+xml$)/;

/**
 * A `no-transform` answer, compressed by the Worker, since the edge leaves it as the Worker sent it: Content-Encoding
 * names the coding the reader takes (./http acceptedEncoding) and the runtime encodes the body as it sends it
 * (ResponseInit `encodeBody: "automatic"`, the default), as the speculation rules file is sent. Vary names
 * Accept-Encoding. Anything else, an answer already encoded, one with no body and a type not worth compressing
 * comes back as it was.
 * @param {Response} response
 * @param {Request} [request]
 */
export function compressUntransformed(response, request) {
  if (
    !response.body ||
    response.headers.has("Content-Encoding") ||
    !NO_TRANSFORM.test(response.headers.get("Cache-Control") ?? "") ||
    !COMPRESSIBLE.test(mediaType(response.headers.get("Content-Type")))
  )
    return response;
  const headers = new Headers(response.headers);
  if (!/(?:^|,)\s*accept-encoding\s*(?:,|$)/i.test(headers.get("Vary") ?? ""))
    headers.append("Vary", "Accept-Encoding");
  const coding = acceptedEncoding(request);
  if (coding) {
    headers.set("Content-Encoding", coding);
    headers.delete("Content-Length");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

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
export function publicPageHeaders({
  tags = [PAGES_CACHE_TAG],
  freshSeconds = 86_400,
  staleSeconds = 604_800,
  until = null,
  now = new Date(),
} = {}) {
  if (
    !Number.isInteger(freshSeconds) ||
    freshSeconds < 0 ||
    !Number.isInteger(staleSeconds) ||
    staleSeconds < 0
  ) {
    throw new Error("publicPageHeaders: freshSeconds and staleSeconds are whole seconds.");
  }
  if (until)
    freshSeconds = Math.min(
      freshSeconds,
      Math.max(UNTIL_FLOOR_SECONDS, Math.ceil((until.getTime() - now.getTime()) / 1000)),
    );
  for (const tag of tags) {
    if (!/^[\x21-\x2b\x2d-\x7e]+$/.test(tag))
      throw new Error(
        `publicPageHeaders: tag "${tag}" holds a comma, a space or a non-ASCII character.`,
      );
  }
  return {
    "Cache-Control": SHARED_CACHE_CONTROL,
    [EDGE_CACHE_HEADER]: `max-age=${freshSeconds}, stale-while-revalidate=${staleSeconds}`,
    "Cache-Tag": tags.join(","),
    // The gateway draws a request carrying any cookie but a public one live, for that reader, so a shared page differs
    // by Cookie (RFC 9110 12.5.5): a cache between the reader and the edge keys a signed-in copy apart from this one.
    Vary: "Cookie",
  };
}

/**
 * Query parameters that only say where a reader came from: ad and newsletter click ids and campaign tags. The page is
 * the same with or without them, so they are left out of the key, as WP Rocket and Cloudflare's cache rules do; the
 * Renderer still gets the full URL. `utm_` is a prefix.
 */
export const TRACKING_PARAMS = [
  "utm_",
  "gclid",
  "gbraid",
  "wbraid",
  "dclid",
  "gad_source",
  "fbclid",
  "msclkid",
  "twclid",
  "ttclid",
  "li_fat_id",
  "igshid",
  "yclid",
  "mc_cid",
  "mc_eid",
  "_ga",
  "_gl",
  "_hsenc",
  "_hsmi",
  "mkt_tok",
  "srsltid",
];

const tracking = (/** @type {string} */ name) =>
  TRACKING_PARAMS.some((t) => (t.endsWith("_") ? name.startsWith(t) : name === t));

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

/** The names of the cookies in a request's Cookie header. */
const cookieNames = (/** @type {Request} */ request) =>
  (request.headers.get("Cookie") ?? "")
    .split(";")
    .map((pair) => pair.split("=")[0].trim())
    .filter(Boolean);

/**
 * Run in the Renderer on every response, last. Anything not marked shared, anything but a 200 (an error page rendered
 * under a shared route's headers) and anything setting a cookie is sent `private, no-store` (keeping `no-transform`); anything not shared gets
 * an edge `no-store` and no tag, so the edge stores only what a purge reaches. Pass the request: a page rendered for a cookie (other than `publicCookies`, which the key
 * already holds) is never stored, and neither is the answer to a HEAD, whose empty body would be served to every
 * reader of the page. A stored page with no validator gets `Last-Modified`, the time it was rendered: it stays the
 * same until a purge or a deploy renders it again, so `forReader` can answer a returning reader 304. Returns the
 * response, rebuilt when its headers are immutable.
 * @param {Response} response
 * @param {Request} [request]
 * @param {{ publicCookies?: readonly string[] }} [options]
 */
export function settleCacheHeaders(response, request, { publicCookies = [] } = {}) {
  const personal =
    response.headers.has("Set-Cookie") ||
    request?.method === "HEAD" ||
    Boolean(request && !cookieNames(request).every((name) => publicCookies.includes(name)));
  const apply = (/** @type {Headers} */ headers) => {
    // A private page keeps no-transform whatever else changes, so its error page or a cookie never lets the beacon in.
    if (!headers.has("Cache-Control") || response.status !== 200 || personal)
      headers.set(
        "Cache-Control",
        NO_TRANSFORM.test(headers.get("Cache-Control") ?? "")
          ? PRIVATE_PAGE_HEADERS["Cache-Control"]
          : UNCACHED,
      );
    if (headers.get("Cache-Control") !== SHARED_CACHE_CONTROL) {
      // Only a shared page is purged on a write, so nothing else is kept at the edge: a route's own lifetime (a feed's
      // hour) stays the browser's, and the Workers cache, which reads this header first (RFC 9213), stores none of it.
      headers.set(EDGE_CACHE_HEADER, "no-store");
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
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

/**
 * The request the gateway sends the Renderer: a HEAD goes as a GET, so what the Workers cache renders and stores, on a
 * miss or a refresh of a stale page, is always the whole page. `forReader` then sends a HEAD reader the headers only.
 * @param {Request} request
 */
export function forRenderer(request) {
  return request.method === "HEAD" ? new Request(request, { method: "GET" }) : request;
}

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
  if (request.method === "HEAD" && response.body) {
    response = new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  if (response.headers.get("Cache-Control") !== SHARED_CACHE_CONTROL) return response;
  if (!cookieNames(request).every((name) => publicCookies.includes(name)))
    return privateRender(response);
  return notModified(response, request) ?? response;
}

/**
 * The 304 for a reader who already holds this page: its ETag in If-None-Match, or (with no If-None-Match) a
 * Last-Modified no later than If-Modified-Since. Null when the page must be sent. RFC 9110 section 13.
 * @param {Response} response
 * @param {Request} request
 */
function notModified(response, request) {
  if (response.status !== 200 || (request.method !== "GET" && request.method !== "HEAD"))
    return null;
  const etag = response.headers.get("ETag");
  const ifNoneMatch = request.headers.get("If-None-Match");
  const weak = (/** @type {string} */ tag) => tag.trim().replace(/^W\//, "");
  let fresh = false;
  if (ifNoneMatch)
    fresh =
      !!etag &&
      (ifNoneMatch.trim() === "*" ||
        ifNoneMatch.split(",").some((tag) => weak(tag) === weak(etag)));
  else {
    const since = Date.parse(request.headers.get("If-Modified-Since") ?? "");
    const modified = Date.parse(response.headers.get("Last-Modified") ?? "");
    fresh = !Number.isNaN(since) && !Number.isNaN(modified) && modified <= since;
  }
  if (!fresh) return null;
  const headers = new Headers(response.headers);
  for (const name of ["Content-Length", "Content-Encoding", "Content-Type"]) headers.delete(name);
  // The 304 carries no body, so the stored one is dropped; a cancel that fails changes nothing the reader gets.
  response.body?.cancel().catch(() => {});
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
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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

/** The KV key holding the last failed purge. */
export const PURGE_FAILED_KEY = "purge:failed";

/**
 * Keeps the last failed purge in KV until a purge succeeds, so a write whose pages stayed stale shows on /health
 * (`purgeCheck`) and not only in a log line: the purge runs after the answer has gone, so the writer cannot be told.
 * One key and no TTL, since an expiring record would turn the check green while the pages are still stale. `false`
 * keeps the failure, `true` clears it, `null` (no purge API) changes nothing. Never throws.
 * @param {{ put(key: string, value: string): Promise<unknown>, delete(key: string): Promise<unknown> } | undefined} kv
 * @param {string} why
 * @param {boolean | null} purged
 * @param {(line: string) => void} [log]
 */
export async function recordPurge(kv, why, purged, log = console.error) {
  if (!kv || purged === null) return;
  try {
    if (purged === false)
      await kv.put(PURGE_FAILED_KEY, JSON.stringify({ why, at: new Date().toISOString() }));
    else await kv.delete(PURGE_FAILED_KEY);
  } catch (error) {
    log(JSON.stringify({ alert: "cache-purge-record-failed", why, detail: String(error) }));
  }
}

/**
 * The Renderer's `purgePages` RPC method, mixed into its class: `class Renderer extends withPurgePages(WorkerEntrypoint)`.
 * The method drops `tags` (default `PAGES_CACHE_TAG`) from the Renderer's own cache; RPC methods bypass the cache.
 * With `kv`, the outcome is recorded (`recordPurge`) for /health's `purgeCheck`, whichever way the purge was asked for.
 * @template {new (...args: any[]) => { ctx: { cache?: any }, env?: any }} T
 * @param {T} Base
 * @param {{ kv?: (env: any) => Parameters<typeof recordPurge>[0] }} [options] the KV namespace to record in, from the Renderer's env
 */
export function withPurgePages(Base, { kv } = {}) {
  return class extends Base {
    /** @param {string} why @param {string[]} [tags] */
    async purgePages(why, tags = [PAGES_CACHE_TAG]) {
      const purged = await purgeTags(this.ctx.cache, tags, why);
      if (kv) await recordPurge(kv(this.env), why, purged);
      return purged;
    }
  };
}

/**
 * In the gateway, after it answers a write: an accepted one (below 400) asks the Renderer to purge, in `waitUntil`, so
 * the answer never waits on it. A read or a refused write purges nothing.
 * @param {Request} request
 * @param {Response} response
 * @param {{ waitUntil(p: Promise<unknown>): void, exports: { Renderer: { purgePages(why: string): Promise<unknown> } } }} ctx
 * @param {string} why
 */
export function purgeAfterWrite(request, response, ctx, why) {
  if (isWrite(request) && response.status < 400)
    ctx.waitUntil(ctx.exports.Renderer.purgePages(why));
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
    // The Renderer is the site's own export, which only the site's generated types know.
    const loopback =
      /** @type {{ Renderer: { purgePages(why: string): Promise<boolean | null> } }} */ (exports);
    return await loopback.Renderer.purgePages(why);
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
    // site-api 0.22.0 sends a null path for a schedule of an item never published: no page exists, so nothing is stored.
    /** @param {{ trigger: string, action: string, path: string | null }} event */
    async run(event) {
      if (event.trigger !== "schedule" || event.path === null) return true;
      return (await purge(`schedule ${event.action} ${event.path}`)) !== false;
    },
  };
}
