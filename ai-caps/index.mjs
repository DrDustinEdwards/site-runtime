/**
 * What keeps an AI feature's bill bounded, split by where the count lives: a Durable Object for an exact site-wide
 * budget (durable-object.mjs, its decisions in core.mjs), `kvCounter` for a soft cap where one extra use is harmless,
 * `reserveSettle` for a cost only known once the call ends (a reader's daily cents), and the pacing that turns a flat
 * daily ceiling into one a flood cannot spend in minutes. Prices are not here: ai-engine.mjs `PRICES` and `costMicros`
 * are the one table, so a site stops copying its own. From dustinedwards.info (workers/ask-budget.ts, ask-pacing.mjs),
 * Germomics (lib/security.server.ts), Capsid (src/doc-index.ts) and Foxing's companion quota.
 */

import { logEvent } from "../log.mjs";
import { windowKey } from "./core.mjs";

export { windowKey, consume, spent, ensureBudgetTable, resetBudget } from "./core.mjs";

const SECONDS_PER_DAY = 86400;

/**
 * Never above `dailyLimit`, so pacing only ever refuses earlier than the flat cap would: a flat cap is a cliff a
 * distributed caller spends in minutes, denying the feature until UTC midnight; paced, the denial ends when the abuse
 * does. The bill is bounded either way.
 * @param {number} dailyLimit total uses permitted in a UTC day
 * @param {number} burst uses available on top of the paced share (without one the first use after midnight is refused)
 * @param {Date} now
 * @returns {number} the ceiling to enforce at this instant
 */
export function pacedAllowance(dailyLimit, burst, now) {
  const elapsed = now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
  // floor, not ceil: at 00:00:00 the allowance is exactly the burst.
  return Math.min(dailyLimit, Math.floor((dailyLimit * elapsed) / SECONDS_PER_DAY) + burst);
}

/**
 * The honest Retry-After under pacing: seconds-until-midnight would send a reader away for a day.
 * @param {number} dailyLimit
 * @returns {number} seconds, at least 1
 */
export function secondsPerPacedUnit(dailyLimit) {
  if (dailyLimit <= 0) return SECONDS_PER_DAY;
  return Math.max(1, Math.round(SECONDS_PER_DAY / dailyLimit));
}

/**
 * A SOFT cap in KV: a count per UTC day or month under `<prefix><window>`. Read-modify-write, so two requests at once
 * can both pass and the count can lose one: right where one extra use costs cents (a monthly search quota, an admin's
 * daily suggestions), wrong where the cap is a promise (use the Durable Object).
 * @param {{ get(key: string): Promise<string | null>, put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> }} kv
 * @param {string} prefix the key before the window: `ai:cap:`
 * @param {number | (() => number | Promise<number>)} cap the ceiling, or a function giving it (a setting read per call)
 * @param {{ window?: "day" | "month", ttlSeconds?: number }} [options] the window (default day); how long a count is
 *   kept (default 36 hours for a day, 40 days for a month: past its window, so a count never outlives its use)
 */
export function kvCounter(kv, prefix, cap, { window = "day", ttlSeconds } = {}) {
  const ttl = ttlSeconds ?? (window === "month" ? 40 * 86400 : 36 * 3600);
  /** @param {Date} now */
  const keyAt = (now) => `${prefix}${windowKey(window, now)}`;
  /** @param {Date} [now] */
  const used = async (now = new Date()) => Number(await kv.get(keyAt(now))) || 0;
  return {
    used,
    /** The cap, as the number it is now. */
    limit: async () => (typeof cap === "function" ? cap() : cap),
    /**
     * Whether the window is at or over the cap: check before the call.
     * @param {Date} [now]
     */
    exceeded: async (now = new Date()) =>
      (await used(now)) >= (typeof cap === "function" ? await cap() : cap),
    /**
     * Count `n` uses: after a call that succeeded.
     * @param {number} [n]
     * @param {Date} [now]
     */
    record: async (n = 1, now = new Date()) => {
      await kv.put(keyAt(now), String((await used(now)) + n), { expirationTtl: ttl });
    },
  };
}

/**
 * Reserve the worst case, run, settle to the real cost: for a call whose cost is only known once it ends (Foxing's
 * companion: cents per reader per day). The reservation is one atomic check-and-add in the site's store; a call that
 * throws keeps it, since the model may have been billed, and under-counting would make the ceiling a suggestion. A
 * failed settle is logged and the reservation stands.
 * @template T
 * @template Slot
 * @param {{
 *   reserve: (worst: number) => Promise<Slot | null>,
 *   settle: (slot: Slot, reserved: number, actual: number) => Promise<void>,
 * }} store `reserve` answers what `settle` needs (the day reserved against) or null when the cap is spent
 * @returns {(worst: number, work: () => Promise<{ value: T, actual: number }>) => Promise<{ ok: true, value: T, actual: number } | { ok: false }>}
 */
export function reserveSettle({ reserve, settle }) {
  return async (worst, work) => {
    const slot = await reserve(worst);
    if (slot === null) return { ok: false };
    const { value, actual } = await work();
    try {
      await settle(slot, worst, actual);
    } catch (error) {
      logEvent("ai_settle_failed", { worst, actual, error }, { level: "error" });
    }
    return { ok: true, value, actual };
  };
}
