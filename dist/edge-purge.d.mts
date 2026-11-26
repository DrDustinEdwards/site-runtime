/**
 * Drops every stored response carrying one of `tags`. Never throws: a failed purge is a stale page until it expires
 * and a log line, not a failed save. A purge refused for its rate (a burst of publishes) is asked again after a pause.
 * `null` when this runtime has no purge (Miniflare), else whether it purged.
 * @param {{ purge?: (o: { tags: string[] }) => Promise<{ success: boolean, errors?: unknown[] }> } | undefined} cache
 *   the Renderer's `this.ctx.cache`: a purge reaches only the cache of the entrypoint that calls it, so one made in the
 *   gateway clears nothing
 * @param {string[]} tags
 * @param {string} why one phrase naming the write, for the log line
 * @param {(line: string) => void} [log]
 * @param {(ms: number) => Promise<unknown>} [pause] the wait between tries
 */
export function purgeTags(cache: {
    purge?: (o: {
        tags: string[];
    }) => Promise<{
        success: boolean;
        errors?: unknown[];
    }>;
} | undefined, tags: string[], why: string, log?: (line: string) => void, pause?: (ms: number) => Promise<unknown>): Promise<boolean | null>;
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
export function recordPurge(kv: {
    put(key: string, value: string): Promise<unknown>;
    delete(key: string): Promise<unknown>;
} | undefined, why: string, purged: boolean | null, log?: (line: string) => void): Promise<void>;
/**
 * @param {Parameters<typeof purgeTags>[0]} cache
 * @param {string[]} tags
 * @param {string} why
 * @param {(purged: boolean | null, why: string) => Promise<unknown>} record
 * @param {(ms: number) => Promise<unknown>} [pause]
 * @returns {Promise<boolean | null>}
 */
export function purgeCoalesced(cache: Parameters<typeof purgeTags>[0], tags: string[], why: string, record: (purged: boolean | null, why: string) => Promise<unknown>, pause?: (ms: number) => Promise<unknown>): Promise<boolean | null>;
/**
 * The Renderer's `purgePages` RPC method, mixed into its class: `class Renderer extends withPurgePages(WorkerEntrypoint)`.
 * The method drops `tags` (default `PAGES_CACHE_TAG`) from the Renderer's own cache; RPC methods bypass the cache. Calls
 * close together share one purge request (`purgeCoalesced`). Awaiting it takes the window plus any rate-limit retries,
 * so a write starts it in `waitUntil` and does not wait.
 * With `kv`, the outcome is recorded (`recordPurge`) for /health's `purgeCheck`, whichever way the purge was asked for.
 * @template {abstract new (...args: any[]) => object} T
 * @param {T} Base WorkerEntrypoint, or a class built on it
 * @param {{ kv?: (env: any) => Parameters<typeof recordPurge>[0] }} [options] the KV namespace to record in, from the Renderer's env
 * @returns {T & (abstract new (...args: any[]) => { purgePages(why: string, tags?: string[]): Promise<boolean | null> })}
 */
export function withPurgePages<T extends abstract new (...args: any[]) => object>(Base: T, { kv }?: {
    kv?: (env: any) => Parameters<typeof recordPurge>[0];
}): T & (abstract new (...args: any[]) => {
    purgePages(why: string, tags?: string[]): Promise<boolean | null>;
});
/**
 * In the gateway, after it answers a write: an accepted one (below 400) asks the Renderer to purge, in `waitUntil`, so
 * the answer never waits on it. A read or a refused write purges nothing.
 * @param {Request} request
 * @param {Response} response
 * @param {{ waitUntil(p: Promise<unknown>): void, exports: { Renderer: { purgePages(why: string): Promise<unknown> } } }} ctx
 * @param {string} why
 */
export function purgeAfterWrite(request: Request, response: Response, ctx: {
    waitUntil(p: Promise<unknown>): void;
    exports: {
        Renderer: {
            purgePages(why: string): Promise<unknown>;
        };
    };
}, why: string): void;
/**
 * From code with no execution context (a cron, a queue, a site-api schedule): asks the Renderer to purge over the
 * Worker's own loopback, `exports` from "cloudflare:workers", imported when called so Node never loads it. Never
 * throws: `null` when the Renderer cannot be reached (logged), else what its purge returned.
 * @param {string} why
 * @param {(line: string) => void} [log]
 * @returns {Promise<boolean | null>}
 */
export function purgeViaRenderer(why: string, log?: (line: string) => void): Promise<boolean | null>;
/**
 * A site-api publish hook (its `PublishHook` shape) that purges the stored pages when a schedule changes one: a
 * schedule has no request, so no gateway purges after it. A Carrel request's write is purged by `purgeAfterWrite`.
 * @param {{ purge?: (why: string) => Promise<boolean | null> }} [options] `purgeViaRenderer` unless given
 * @returns {{ name: "edge-page-purge"; run(event: { trigger: string; action: string; path: string | null }): Promise<boolean> }}
 */
export function schedulePurgeHook({ purge }?: {
    purge?: (why: string) => Promise<boolean | null>;
}): {
    name: "edge-page-purge";
    run(event: {
        trigger: string;
        action: string;
        path: string | null;
    }): Promise<boolean>;
};
/** The tag a page carries when the route names none, and the one `purgeTags` is usually called with. */
export const PAGES_CACHE_TAG: "pages";
export const PURGE_FAILED_KEY: "purge:failed";
