// A Workers built-in, not an npm package.
import { DurableObject } from "cloudflare:workers";
import { decideAcquire, decideRelease } from "./core.mjs";
import { armIfIdle, tick, TICKER_INTERVAL_MS } from "./index.mjs";

/** The record's storage key (Foxhound's, so its stored leases carry over). */
const LOCK_KEY = "lock";

/**
 * One job's mutex, addressed by `idFromName(jobName)`, so two overlapping firings of one job cannot both run. A lease
 * with a fence: `acquire` answers the holder's token or null when held, and only that token releases.
 */
export class CronLock extends DurableObject {
  /** @returns {Promise<import("./core.mjs").LockRecord | null>} */
  async #read() {
    return (await this.ctx.storage.get(LOCK_KEY)) ?? null;
  }

  /**
   * Take the lock for up to `leaseMs`: the holder's token, or null when another run holds it.
   * @param {number} leaseMs
   */
  async acquire(leaseMs) {
    const decision = decideAcquire(await this.#read(), Date.now(), leaseMs, crypto.randomUUID());
    if (!decision.granted) return null;
    await this.ctx.storage.put(LOCK_KEY, decision.record);
    return decision.record.token;
  }

  /**
   * Free the lock, only for the run that holds it.
   * @param {string} token
   */
  async release(token) {
    if (decideRelease(await this.#read(), token)) await this.ctx.storage.delete(LOCK_KEY);
  }

  /** When the lease ends, or null; never the token, which is the fence. */
  async peek() {
    return (await this.#read())?.heldUntil ?? null;
  }
}

/**
 * The ticker: one instance whose alarm runs a site's sub-hourly jobs every `intervalMs` whether or not Cloudflare fires
 * the trigger. A site extends it with `run()` (its jobs, through runJobs) and calls ensureTickerArmed from scheduled()
 * and queue(), never from fetch().
 */
export class CronTicker extends DurableObject {
  /** How often the alarm fires. */
  get intervalMs() {
    return TICKER_INTERVAL_MS;
  }

  /** @returns {Promise<unknown>} */
  async run() {
    throw new Error("A CronTicker subclass defines run()");
  }

  /** Set the alarm if none is set; true when it set one. */
  ensureArmed() {
    return armIfIdle(this.ctx.storage, this.intervalMs);
  }

  alarm() {
    return tick(this.ctx.storage, () => this.run(), this.intervalMs);
  }
}
