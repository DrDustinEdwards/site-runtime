/** The cron lock's pure decisions (cron-lock/core.mjs). */
export interface LockRecord {
  heldUntil: number;
  token: string;
}
export type AcquireDecision = { granted: false } | { granted: true; record: LockRecord };
/** Whether a caller may take the lock; an expiry of exactly now has run out. */
export function decideAcquire(
  lock: LockRecord | null,
  now: number,
  leaseMs: number,
  token: string,
): AcquireDecision;
/** Whether a release may clear the lock: only its holder's token does. */
export function decideRelease(lock: LockRecord | null, token: string): boolean;
/** idle, running or not-released, from the lease's end. */
export function lockHealth(
  heldUntil: number | null,
  now: number,
): { state: "idle" | "running" | "not-released"; heldUntil: number | null };
