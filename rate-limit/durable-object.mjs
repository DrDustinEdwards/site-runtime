// A Workers built-in, not an npm package.
import { DurableObject } from "cloudflare:workers";
import { hitRules, idleDeadline, peekRules, purgeExpired } from "./core.mjs";

/**
 * The Durable Object class a Worker exports and binds (SQLite-backed). One instance per key holds
 * every window for that key. After the longest window ends an alarm deletes its storage, so an idle
 * key's instance is released.
 *
 * A Worker that already has a Durable Object class it cannot rename can extend this one: the counting
 * lives in its own table, apart from anything the subclass stores.
 */
export class RateLimiter extends DurableObject {
  /**
   * @param {import("./core.mjs").Rule[]} rules
   * @param {number} [nowMs]
   */
  async hit(rules, nowMs = Date.now()) {
    // The count is one synchronous block (hitRules has no await); the alarm write follows it.
    const result = hitRules(this.ctx.storage.sql, rules, nowMs);
    if (result.ok) await this.ctx.storage.setAlarm(idleDeadline(rules, nowMs));
    return result;
  }

  /**
   * Whether `rules` are spent, counting nothing (`limit(..., { peek: true })`).
   * @param {import("./core.mjs").Rule[]} rules
   * @param {number} [nowMs]
   */
  async peek(rules, nowMs = Date.now()) {
    return peekRules(this.ctx.storage.sql, rules, nowMs);
  }

  async alarm() {
    const remaining = purgeExpired(this.ctx.storage.sql, Date.now());
    if (remaining !== null) await this.ctx.storage.setAlarm(remaining);
  }
}
