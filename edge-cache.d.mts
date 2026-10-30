/**
 * A public page stored at the edge by the Workers cache, purged by tag on a write (edge-cache.mjs): the gateway and
 * Renderer scheme dustinedwards.info runs. Only a page that is the same for every reader may be stored.
 */

export const SHARED_CACHE_CONTROL: "public, max-age=0";
export const UNCACHED: "private, no-store";
export const EDGE_CACHE_HEADER: "Cloudflare-CDN-Cache-Control";
export const PAGES_CACHE_TAG: "pages";

/** A route's `headers` to have its page stored: a day fresh, a week stale, tagged "pages" unless `tags` says otherwise; fresh no later than `until` (a minute at least). */
export function publicPageHeaders(options?: { tags?: string[]; freshSeconds?: number; staleSeconds?: number; until?: Date | null; now?: Date }): Record<string, string>;

/** Ad click ids and campaign tags left out of the key (`utm_` is a prefix). */
export const TRACKING_PARAMS: string[];

/** The path and sorted query without tracking parameters, plus `;name=value` per dimension, for `cf: { cacheKey }` on the gateway's call to the Renderer. */
export function cacheKey(url: URL | string, options?: { dimensions?: Record<string, string | undefined> }): string;

/** The Renderer's last step: anything not a shared 200, setting a cookie, or rendered for a request with one, leaves `private, no-store`, with no edge header or tag. */
export function settleCacheHeaders(response: Response, request?: Request): Response;

/** The gateway's last step: a shared page answered to a request with a cookie not in `publicCookies` is `no-store` for the browser. */
export function forReader(response: Response, request: Request, options?: { publicCookies?: readonly string[] }): Response;

/** A page rendered for one reader: `private, no-store`, no edge header, no tag. */
export function privateRender(response: Response): Response;

export interface PurgeCache {
  purge?: (options: { tags: string[] }) => Promise<{ success: boolean; errors?: unknown[] }>;
}

/** Purges `tags`, never throwing. Call it in the Renderer (`this.ctx.cache`): a purge reaches only the calling entrypoint's cache. `null` with no purge API (Miniflare), `true` purged, `false` refused or threw (logged). */
export function purgeTags(cache: PurgeCache | undefined, tags: string[], why: string, log?: (line: string) => void): Promise<boolean | null>;

/** Mixes the `purgePages(why, tags?)` RPC method into the Renderer: `class Renderer extends withPurgePages(WorkerEntrypoint)`. */
export function withPurgePages<T extends abstract new (...args: any[]) => object>(
  Base: T,
): T & (abstract new (...args: any[]) => { purgePages(why: string, tags?: string[]): Promise<boolean | null> });

/** In the gateway: an accepted write (below 400) asks the Renderer to purge, in `waitUntil`. */
export function purgeAfterWrite(
  request: Request,
  response: Response,
  ctx: { waitUntil(promise: Promise<unknown>): void; exports: { Renderer: { purgePages(why: string): Promise<unknown> } } },
  why: string,
): void;

/** From a cron, a queue or a schedule: asks the Renderer to purge over `exports` from "cloudflare:workers". Never throws; `null` when unreachable. */
export function purgeViaRenderer(why: string, log?: (line: string) => void): Promise<boolean | null>;

/** A site-api `PublishHook` that purges after a schedule changes a page. */
export function schedulePurgeHook(options?: { purge?: (why: string) => Promise<boolean | null> }): {
  name: "edge-page-purge";
  run(event: { trigger: string; action: string; path: string }): Promise<boolean>;
};
