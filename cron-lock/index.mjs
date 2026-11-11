/**
 * A scheduled job under a lease (./cron-lock), and the five-minute ticker that runs sub-hourly jobs from a Durable
 * Object alarm (Cloudflare stopped firing Foxhound's "*\/5" trigger from 2026-10-23 while it still listed it). From
 * Foxhound (workers/cron-lock.ts, app/lib/cron/lock-state.ts, ticker.ts).
 *
 * The Worker exports `CronLock` (./cron-lock/durable-object) and binds it; `withLease` takes the job's lease, runs it,
 * and releases only its own token. A held lease resolves to CRON_SKIPPED, so runJobs logs it skipped and records no
 * success.
 */

import { CRON_SKIPPED } from "../cron.mjs";
import { logEvent } from "../log.mjs";

export { decideAcquire, decideRelease, lockHealth } from "./core.mjs";

/** The ticker's alarm interval: five minutes. */
export const TICKER_INTERVAL_MS = 5 * 60_000;

/**
 * Run `fn` holding the lease named `name`, or answer CRON_SKIPPED when another run holds it.
 * @template T
 * @param {{ idFromName(name: string): DurableObjectId, get(id: DurableObjectId): { acquire(leaseMs: number): Promise<string | null>, release(token: string): Promise<void> } }} ns
 * @param {string} name
 * @param {number} leaseMs
 * @param {() => Promise<T>} fn
 * @returns {Promise<T | typeof CRON_SKIPPED>}
 */
export async function withLease(ns, name, leaseMs, fn) {
  const lock = ns.get(ns.idFromName(name));
  const token = await lock.acquire(leaseMs);
  if (token === null) {
    logEvent("cron_job_locked", { name });
    return CRON_SKIPPED;
  }
  try {
    return await fn();
  } finally {
    await lock
      .release(token)
      .catch((error) => logEvent("cron_lock_release_failed", { name, error }, { level: "error" }));
  }
}

/**
 * Set the ticker's alarm only if none is set; true when it set one. Only if none: a caller on every queue batch that
 * always reset it would keep pushing the next tick away.
 * @param {{ getAlarm(): Promise<number | null>, setAlarm(at: number): Promise<void> }} storage
 * @param {number} [intervalMs]
 * @param {number} [now]
 */
export async function armIfIdle(storage, intervalMs = TICKER_INTERVAL_MS, now = Date.now()) {
  if ((await storage.getAlarm()) !== null) return false;
  await storage.setAlarm(now + intervalMs);
  return true;
}

/**
 * The ticker's alarm: re-arm first, then run. Re-arming first keeps the chain alive when the run throws or is cut off;
 * the run's throw is swallowed (and logged), since an alarm that throws is retried, which would run the jobs again.
 * @param {{ setAlarm(at: number): Promise<void> }} storage
 * @param {() => Promise<unknown>} run
 * @param {number} [intervalMs]
 * @param {number} [now]
 */
export async function tick(storage, run, intervalMs = TICKER_INTERVAL_MS, now = Date.now()) {
  await storage.setAlarm(now + intervalMs);
  await run().catch((error) => logEvent("cron_ticker_run_failed", { error }, { level: "error" }));
}

/**
 * Ask the ticker named `name` to make sure its alarm is set. Never throws: a failed arm must not stop the cron or fail
 * a queue batch, and the next caller tries again.
 * @param {{ idFromName(name: string): DurableObjectId, get(id: DurableObjectId): { ensureArmed(): Promise<boolean> } } | undefined} ns
 * @param {string} name
 */
export async function ensureTickerArmed(ns, name) {
  try {
    if (!ns) throw new Error("no ticker binding");
    await ns.get(ns.idFromName(name)).ensureArmed();
  } catch (error) {
    logEvent("cron_ticker_arm_failed", { name, error }, { level: "error" });
  }
}
