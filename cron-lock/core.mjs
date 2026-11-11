/**
 * The cron lock's decisions as pure functions over its stored record, so the fence is a tested property and the
 * Durable Object (durable-object.mjs) is only a storage shell. From Foxhound (app/lib/cron/lock-state.ts).
 *
 * A LEASE, NOT A FLAG: a lock whose expiry has passed is free, so a run that died without releasing frees its job
 * instead of wedging it. FENCED: acquiring mints a token and only that token releases, so an overrunning run's late
 * release cannot free the next run's lease and let a third in beside it.
 */

/**
 * Whether a caller may take the lock, and the record it writes. An expiry of exactly now has run out.
 * @param {import("./core.d.mts").LockRecord | null} lock
 * @param {number} now
 * @param {number} leaseMs
 * @param {string} token
 * @returns {import("./core.d.mts").AcquireDecision}
 */
export function decideAcquire(lock, now, leaseMs, token) {
  if (lock !== null && lock.heldUntil > now) return { granted: false };
  return { granted: true, record: { heldUntil: now + leaseMs, token } };
}

/**
 * Whether a release may clear the lock: only its holder's. A stale holder's release is a no-op, the expected end of an
 * overrun.
 * @param {import("./core.d.mts").LockRecord | null} lock
 * @param {string} token
 */
export function decideRelease(lock, token) {
  return lock !== null && lock.token === token;
}

/**
 * The lock's state for an operations page: idle (no lease), running (a lease that has not run out) or not-released (a
 * lease that ran out without its release: the run was cut off or is still going past it).
 * @param {number | null} heldUntil the lease's end, as `peek` reads it
 * @param {number} now
 * @returns {{ state: "idle" | "running" | "not-released", heldUntil: number | null }}
 */
export function lockHealth(heldUntil, now) {
  if (heldUntil === null) return { state: "idle", heldUntil: null };
  return { state: heldUntil > now ? "running" : "not-released", heldUntil };
}
