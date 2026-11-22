/**
 * Never above `dailyLimit`, so pacing only ever refuses earlier than the flat cap would: a flat cap is a cliff a
 * distributed caller spends in minutes, denying the feature until UTC midnight; paced, the denial ends when the abuse
 * does. The bill is bounded either way.
 * @param {number} dailyLimit total uses permitted in a UTC day
 * @param {number} burst uses available on top of the paced share (without one the first use after midnight is refused)
 * @param {Date} now
 * @returns {number} the ceiling to enforce at this instant
 */
export function pacedAllowance(dailyLimit: number, burst: number, now: Date): number;
/**
 * The honest Retry-After under pacing: seconds-until-midnight would send a reader away for a day.
 * @param {number} dailyLimit
 * @returns {number} seconds, at least 1
 */
export function secondsPerPacedUnit(dailyLimit: number): number;
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
export function kvCounter(kv: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options?: {
        expirationTtl?: number;
    }): Promise<void>;
}, prefix: string, cap: number | (() => number | Promise<number>), { window, ttlSeconds }?: {
    window?: "day" | "month";
    ttlSeconds?: number;
}): {
    used: (now?: Date) => Promise<number>;
    /** The cap, as the number it is now. */
    limit: () => Promise<number>;
    /**
     * Whether the window is at or over the cap: check before the call.
     * @param {Date} [now]
     */
    exceeded: (now?: Date) => Promise<boolean>;
    /**
     * Count `n` uses: after a call that succeeded.
     * @param {number} [n]
     * @param {Date} [now]
     */
    record: (n?: number, now?: Date) => Promise<void>;
};
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
export function reserveSettle<T, Slot>({ reserve, settle }: {
    reserve: (worst: number) => Promise<Slot | null>;
    settle: (slot: Slot, reserved: number, actual: number) => Promise<void>;
}): (worst: number, work: () => Promise<{
    value: T;
    actual: number;
}>) => Promise<{
    ok: true;
    value: T;
    actual: number;
} | {
    ok: false;
}>;
/**
 * The part of a KV namespace a counter uses.
 */
export type CounterKv = {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options?: {
        expirationTtl?: number;
    }): Promise<void>;
};
export type SqlLike = import("./core.mjs").SqlLike;
export { windowKey, consume, spent, ensureBudgetTable, resetBudget } from "./core.mjs";
