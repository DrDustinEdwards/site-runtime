/**
 * A `no-transform` answer, compressed by the Worker: Content-Encoding names the coding the reader takes (./http
 * acceptedEncoding) and the runtime encodes the body (`encodeBody: "automatic"`). Vary names Accept-Encoding.
 * An answer already encoded, with no body, or of a type not worth compressing comes back as it was.
 * @param {Response} response
 * @param {Request} [request]
 */
export function compressUntransformed(response: Response, request?: Request): Response;
/**
 * The headers a route returns to have its page stored. A day fresh, a week served stale while it re-renders: safe
 * because every write purges and every deploy starts cold (the Worker version is in the key unless
 * `cross_version_cache` is on). Sent as `Cloudflare-CDN-Cache-Control`, never `s-maxage`, which implies
 * proxy-revalidate and refuses stale. `until` is when the page changes with no write to purge on (the next
 * scheduled post): it stays fresh no later than that, and no less than a minute.
 * @param {{ tags?: string[], freshSeconds?: number, staleSeconds?: number, until?: Date | null, now?: Date }} [options]
 */
export function publicPageHeaders({ tags, freshSeconds, staleSeconds, until, now, }?: {
    tags?: string[];
    freshSeconds?: number;
    staleSeconds?: number;
    until?: Date | null;
    now?: Date;
}): {
    "Cache-Control": string;
    "Cloudflare-CDN-Cache-Control": string;
    "Cache-Tag": string;
    Vary: string;
};
/**
 * The Renderer's cache key: the path, then the query without `TRACKING_PARAMS`, sorted so `?a&b` and `?b&a` share one
 * entry. A custom `cf.cacheKey` replaces the platform's own path and query. `dimensions` are what else the page varies
 * by (a theme read from a cookie), each added as `;name=value` after the query.
 * @param {URL | string} url
 * @param {{ dimensions?: Record<string, string | undefined> }} [options]
 */
export function cacheKey(url: URL | string, { dimensions }?: {
    dimensions?: Record<string, string | undefined>;
}): string;
/**
 * Run in the Renderer on every response, last. Anything not marked shared, anything but a 200 and anything setting
 * a cookie is sent `private, no-store` (keeping `no-transform`) with an edge `no-store` and no tag, so the edge
 * stores only what a purge reaches. Pass the request: a page rendered for a cookie (other than `publicCookies`,
 * which the key already holds) is never stored, nor is the answer to a HEAD. A stored page with no validator gets
 * `Last-Modified`, so `forReader` can answer a returning reader 304. Returns the response, rebuilt when its
 * headers are immutable.
 * @param {Response} response
 * @param {Request} [request]
 * @param {{ publicCookies?: readonly string[] }} [options]
 */
export function settleCacheHeaders(response: Response, request?: Request, { publicCookies }?: {
    publicCookies?: readonly string[];
}): Response;
/**
 * A shared page's ETag, from its body, so every stored copy carries the same validator (a render-time
 * `Last-Modified` differs between copies, so a conditional request got 200 from another copy). Run in the Renderer
 * (`forRenderer`, only GETs) before `settleCacheHeaders`. A page that is not shared, has a cookie to set, or names
 * its own ETag comes back as it was. Weak, since the edge compresses the body. Kept small: bundled bytes count.
 * @param {Response} response
 * @returns {Promise<Response>}
 */
export function stampValidator(response: Response): Promise<Response>;
/**
 * The request the gateway sends the Renderer: a HEAD goes as a GET, so what the Workers cache renders and stores, on a
 * miss or a refresh of a stale page, is always the whole page. `forReader` then sends a HEAD reader the headers only.
 * @param {Request} request
 */
export function forRenderer(request: Request): Request<any, CfProperties<any>>;
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
export function forReader(response: Response, request: Request, { publicCookies }?: {
    publicCookies?: readonly string[];
}): Response;
/**
 * A page rendered for one reader, on a path that never reaches the Renderer: whatever its route said, it leaves
 * `private, no-store` with no edge header and no tag, so neither the edge nor a browser keeps it. A WebSocket upgrade
 * (101, or a Response carrying its `webSocket`) is the socket itself, not a page, and comes back as it is: rebuilding
 * it would drop the socket (the same rule as ./headers applyHeaderSet).
 * @param {Response} response
 */
export function privateRender(response: Response): Response;
export * from "./edge-purge.mjs";
/**
 * @typedef {object} PurgeCache
 * @property {(options: { tags: string[] }) => Promise<{ success: boolean; errors?: unknown[] }>} [purge]
 */
/** Stored at the edge, never in a browser: a purge cannot reach a browser, so max-age stays 0. */
export const SHARED_CACHE_CONTROL: "public, max-age=0";
/**
 * The default for anything a route does not mark shared (omitting Cache-Control is not opting out: the platform
 * caches heuristically). A signed-in page keeps it on purpose despite the back/forward cache cost in Firefox and
 * Safari: it is private data (OWASP ASVS 5.0, 14.3.2). Public pages are never no-store: publicPageHeaders sends
 * `public, max-age=0`.
 */
export const UNCACHED: "private, no-store";
/**
 * The `headers` of every private page (admin, signed-in, sign-in, account, any page drawn for one reader): UNCACHED
 * plus `no-transform`, so the Web Analytics beacon never reaches it and only public pages are counted. Cloudflare
 * then compresses nothing, so the Worker does (`compressUntransformed`). Pages only, never assets.
 */
export const PRIVATE_PAGE_HEADERS: Readonly<{
    "Cache-Control": "private, no-store, no-transform";
}>;
/** Outranks Cache-Control at Cloudflare's edge, so it goes only on a response marked shared. */
export const EDGE_CACHE_HEADER: "Cloudflare-CDN-Cache-Control";
/**
 * Query parameters that only say where a reader came from: ad and newsletter click ids and campaign tags. The page is
 * the same with or without them, so they are left out of the key; the Renderer still gets the full URL. `utm_` is
 * a prefix.
 */
export const TRACKING_PARAMS: string[];
export type PurgeCache = {
    purge?: ((options: {
        tags: string[];
    }) => Promise<{
        success: boolean;
        errors?: unknown[];
    }>) | undefined;
};
