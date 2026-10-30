/**
 * A public page stored at the edge by the Workers cache, purged by tag on a write (edge-cache.mjs): the gateway and
 * Renderer scheme dustinedwards.info runs. Only a page that is the same for every reader may be stored.
 */

export const SHARED_CACHE_CONTROL: "public, max-age=0";
export const UNCACHED: "private, no-store";
export const EDGE_CACHE_HEADER: "Cloudflare-CDN-Cache-Control";
export const PAGES_CACHE_TAG: "pages";

/** A route's `headers` to have its page stored: a day fresh, a week stale, tagged "pages" unless `tags` says otherwise. */
export function publicPageHeaders(options?: { tags?: string[]; freshSeconds?: number; staleSeconds?: number }): Record<string, string>;

/** The path and query, for `cf: { cacheKey }` on the gateway's call to the Renderer. */
export function cacheKey(url: URL | string): string;

/** The Renderer's last step: anything not a shared 200 leaves `private, no-store`, with no edge header. */
export function settleCacheHeaders(response: Response): Response;

/** The gateway's last step: a shared page answered to a request with a cookie is `no-store` for the browser. */
export function forReader(response: Response, request: Request): Response;

export interface PurgeCache {
  purge?: (options: { tags: string[] }) => Promise<{ success: boolean; errors?: unknown[] }>;
}

/** Purges `tags`, never throwing. `null` with no purge API (Miniflare), `true` purged, `false` refused or threw (logged). */
export function purgeTags(cache: PurgeCache | undefined, tags: string[], why: string, log?: (line: string) => void): Promise<boolean | null>;
