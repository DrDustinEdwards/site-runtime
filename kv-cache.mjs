/**
 * A KV-held copy of a read that many requests repeat and that changes rarely: a counting query over most of a table
 * on every page (Foxing's nav clubs and genre facets), a bucket listing behind /health (dei's media index verdict).
 * Every site wrote the same read-through by hand.
 *
 * - A hit is a value `valid` accepts (default: anything but null); anything else, or a KV read that throws, is a miss.
 *   `refresh` skips the lookup and always reads (a "fresh" request), and what it reads still replaces the entry.
 * - A miss runs `read`. What it returns is kept for `ttl` seconds, at least 60, KV's floor
 *   (developers.cloudflare.com/kv/api/write-key-value-pairs/), unless `keep` refuses it (an empty answer is a failed
 *   one). A `read` that throws keeps nothing and throws on.
 * - A failed write costs one more read, never the answer. A failed read or write is logged at warn.
 *
 * KV is eventually consistent: a fresh write can take up to 60 seconds to reach other locations, and a delete by name
 * is the way to drop an entry a write made stale (`kv.delete(key)`). Never use it for what a person just wrote and
 * expects to see. A module-level memo would not do: Workers keep no state in module scope
 * (developers.cloudflare.com/workers/best-practices/workers-best-practices/), and isolates are many and short-lived.
 */

import { logEvent } from "./log.mjs";

/** KV's shortest expirationTtl, in seconds. */
export const KV_MIN_TTL = 60;

/**
 * @template T
 * @param {import("./kv-cache.d.mts").KvLike | null | undefined} kv the namespace; none reads straight through
 * @param {string} key
 * @param {import("./kv-cache.d.mts").KvCacheOptions<T>} options
 * @param {() => Promise<T>} read
 * @returns {Promise<T>}
 */
export async function kvCached(kv, key, { ttl, valid = (v) => v !== null, keep, refresh }, read) {
  if (!kv) return read();
  if (!refresh) {
    try {
      const kept = await kv.get(key, "json");
      if (kept !== null && valid(kept)) return /** @type {T} */ (kept);
    } catch (error) {
      // An unreadable entry is a miss.
      logEvent("kv_cache_read_failed", { key, error }, { level: "warn" });
    }
  }
  const value = await read();
  if (keep && !keep(value)) return value;
  try {
    await kv.put(key, JSON.stringify(value), {
      expirationTtl: Math.max(KV_MIN_TTL, Math.ceil(ttl)),
    });
  } catch (error) {
    // A failed write costs one more read, never the answer.
    logEvent("kv_cache_write_failed", { key, error }, { level: "warn" });
  }
  return value;
}
