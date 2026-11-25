/** Purging the stored pages by tag: the Renderer's purge method, batching, and the callers (see edge-cache.mjs). */

import { isWrite } from "./http.mjs";

/** The tag a page carries when the route names none, and the one `purgeTags` is usually called with. */
export const PAGES_CACHE_TAG = "pages";

/** The wait between purge tries and before a batch goes out; a test passes its own. */
const wait = (/** @type {number} */ ms) => scheduler.wait(ms);

/** Cloudflare's code for a purge refused for its rate; asked again up to this many times, after 1, 2, 4 and 8 s. */
const PURGE_RATE_LIMITED = 1134;
const PURGE_RETRIES = 4;

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
export async function purgeTags(cache, tags, why, log = console.error, pause = wait) {
  if (typeof cache?.purge !== "function") return null;
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await cache.purge({ tags });
      if (result?.success) return true;
      const errors = result?.errors ?? [];
      if (
        attempt < PURGE_RETRIES &&
        errors.some((e) => /** @type {any} */ (e)?.code === PURGE_RATE_LIMITED)
      ) {
        await pause(1000 << attempt);
        continue;
      }
      log(JSON.stringify({ alert: "cache-purge-refused", why, tags, errors }));
    } catch (error) {
      log(JSON.stringify({ alert: "cache-purge-threw", why, tags, detail: String(error) }));
    }
    return false;
  }
}

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

/** Purges asked within this long of each other go out as one request (ms). */
const PURGE_WINDOW_MS = 250;
/** Cloudflare accepts at most 100 tags in one purge request. */
const PURGE_MAX_TAGS = 100;

/**
 * Purge requests are rationed per account (Free: 5 a minute, bucket of 25, Workers Caching always on the Free limits), so
 * a write that asks several times, or several writes close together, would empty the bucket. Tags asked for within
 * `PURGE_WINDOW_MS` are merged into one `purgeTags` request; each caller gets that request's outcome. One batch is open
 * at a time per isolate, and a full one (100 tags) closes at once.
 * @type {{ tags: Set<string>, whys: Set<string>, done?: Promise<boolean | null> } | null}
 */
let openBatch = null;

/**
 * @param {Parameters<typeof purgeTags>[0]} cache
 * @param {string[]} tags
 * @param {string} why
 * @param {(purged: boolean | null, why: string) => Promise<unknown>} record
 * @param {(ms: number) => Promise<unknown>} [pause]
 * @returns {Promise<boolean | null>}
 */
export function purgeCoalesced(cache, tags, why, record, pause = wait) {
  if (!openBatch || openBatch.tags.size + tags.length > PURGE_MAX_TAGS) {
    const batch = (openBatch = /** @type {NonNullable<typeof openBatch>} */ ({
      tags: new Set(),
      whys: new Set(),
    }));
    batch.done = (async () => {
      await pause(PURGE_WINDOW_MS);
      if (openBatch === batch) openBatch = null;
      const reason = [...batch.whys].join("; ");
      const purged = await purgeTags(cache, [...batch.tags], reason);
      await record(purged, reason);
      return purged;
    })();
  }
  for (const tag of tags) openBatch.tags.add(tag);
  openBatch.whys.add(why);
  return /** @type {Promise<boolean | null>} */ (openBatch.done);
}

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
export function withPurgePages(Base, { kv } = {}) {
  // JavaScript cannot declare the abstract class TypeScript asks of a mixin over an abstract base, so the body sees the
  // base as the concrete entrypoint it is at run time.
  const Entrypoint = /** @type {new (...args: any[]) => { ctx: { cache?: any }, env?: any }} */ (
    /** @type {unknown} */ (Base)
  );
  const Mixed = class extends Entrypoint {
    /** @param {string} why @param {string[]} [tags] */
    purgePages(why, tags = [PAGES_CACHE_TAG]) {
      return purgeCoalesced(this.ctx.cache, tags, why, (purged, reason) =>
        recordPurge(kv?.(this.env), reason, purged),
      );
    }
  };
  return /** @type {any} */ (Mixed);
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
 * @returns {{ name: "edge-page-purge"; run(event: { trigger: string; action: string; path: string | null }): Promise<boolean> }}
 */
export function schedulePurgeHook({ purge = purgeViaRenderer } = {}) {
  return {
    name: "edge-page-purge",
    // site-api sends a null path for a schedule of an item never published: no page exists, so nothing is stored.
    /** @param {{ trigger: string, action: string, path: string | null }} event */
    async run(event) {
      if (event.trigger !== "schedule" || event.path === null) return true;
      return (await purge(`schedule ${event.action} ${event.path}`)) !== false;
    },
  };
}
