/**
 * The cron lock's decisions as pure functions over its stored record, so the fence is a tested property and the
 * Durable Object (durable-object.mjs) is only a storage shell.
 *
 * A LEASE, NOT A FLAG: a lock whose expiry has passed is free, so a run that died without releasing frees its job
 * instead of wedging it. FENCED: acquiring mints a token and only that token releases, so an overrunning run's late
 * release cannot free the next run's lease and let a third in beside it.
 */
/**
 * The cron lock's pure decisions (cron-lock/core.mjs).
 * @typedef {object} LockRecord
 * @property {number} heldUntil
 * @property {string} token
 */
/** @import { AcquireDecision } from "./index.mjs" */
/**
 * Whether a caller may take the lock, and the record it writes. An expiry of exactly now has run out.
 * @param {LockRecord | null} lock
 * @param {number} now
 * @param {number} leaseMs
 * @param {string} token
 * @returns {AcquireDecision}
 */
export function decideAcquire(lock: LockRecord | null, now: number, leaseMs: number, token: string): AcquireDecision;
/**
 * Whether a release may clear the lock: only its holder's. A stale holder's release is a no-op, the expected end of an
 * overrun.
 * @param {LockRecord | null} lock
 * @param {string} token
 */
export function decideRelease(lock: LockRecord | null, token: string): boolean;
/**
 * The lock's state for an operations page: idle (no lease), running (a lease that has not run out) or not-released (a
 * lease that ran out without its release: the run was cut off or is still going past it).
 * @param {number | null} heldUntil the lease's end, as `peek` reads it
 * @param {number} now
 * @returns {{ state: "idle" | "running" | "not-released", heldUntil: number | null }}
 */
export function lockHealth(heldUntil: number | null, now: number): {
    state: "idle" | "running" | "not-released";
    heldUntil: number | null;
};
/**
 * The cron lock's pure decisions (cron-lock/core.mjs).
 */
export type LockRecord = {
    heldUntil: number;
    token: string;
};
import type { AcquireDecision } from "./index.mjs";
