/**
 * Run `fn` holding the lease named `name`, or answer CRON_SKIPPED when another run holds it.
 * @template T
 * @param {{ idFromName(name: string): DurableObjectId, get(id: DurableObjectId): { acquire(leaseMs: number): Promise<string | null>, release(token: string): Promise<void> } }} ns
 * @param {string} name
 * @param {number} leaseMs
 * @param {() => Promise<T>} fn
 * @returns {Promise<T | typeof CRON_SKIPPED>}
 */
export function withLease<T>(ns: {
    idFromName(name: string): DurableObjectId;
    get(id: DurableObjectId): {
        acquire(leaseMs: number): Promise<string | null>;
        release(token: string): Promise<void>;
    };
}, name: string, leaseMs: number, fn: () => Promise<T>): Promise<T | typeof CRON_SKIPPED>;
/**
 * Set the ticker's alarm only if none is set; true when it set one. Only if none: a caller on every queue batch that
 * always reset it would keep pushing the next tick away.
 * @param {{ getAlarm(): Promise<number | null>, setAlarm(at: number): Promise<void> }} storage
 * @param {number} [intervalMs]
 * @param {number} [now]
 */
export function armIfIdle(storage: {
    getAlarm(): Promise<number | null>;
    setAlarm(at: number): Promise<void>;
}, intervalMs?: number, now?: number): Promise<boolean>;
/**
 * The ticker's alarm: re-arm first, then run. Re-arming first keeps the chain alive when the run throws or is cut off;
 * the run's throw is swallowed (and logged), since an alarm that throws is retried, which would run the jobs again.
 * @param {{ setAlarm(at: number): Promise<void> }} storage
 * @param {() => Promise<unknown>} run
 * @param {number} [intervalMs]
 * @param {number} [now]
 */
export function tick(storage: {
    setAlarm(at: number): Promise<void>;
}, run: () => Promise<unknown>, intervalMs?: number, now?: number): Promise<void>;
/**
 * Ask the ticker named `name` to make sure its alarm is set. Never throws: a failed arm must not stop the cron or fail
 * a queue batch, and the next caller tries again.
 * @param {{ idFromName(name: string): DurableObjectId, get(id: DurableObjectId): { ensureArmed(): Promise<boolean> } } | undefined} ns
 * @param {string} name
 */
export function ensureTickerArmed(ns: {
    idFromName(name: string): DurableObjectId;
    get(id: DurableObjectId): {
        ensureArmed(): Promise<boolean>;
    };
} | undefined, name: string): Promise<void>;
/** @typedef {import("./core.mjs").LockRecord} LockRecord */
/** @typedef {import("./core.mjs").AcquireDecision} AcquireDecision */
/** The ticker's alarm interval: five minutes. */
export const TICKER_INTERVAL_MS: number;
export type Namespace<T> = {
    idFromName(name: string): DurableObjectId;
    get(id: DurableObjectId): T;
};
export type LockRecord = import("./core.mjs").LockRecord;
export type AcquireDecision = import("./core.mjs").AcquireDecision;
import { CRON_SKIPPED } from "../cron.mjs";
export { decideAcquire, decideRelease, lockHealth } from "./core.mjs";
