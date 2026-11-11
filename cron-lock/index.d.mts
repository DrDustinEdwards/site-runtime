/** A job under a fenced lease and the five-minute alarm ticker (./cron-lock). */
import type { CRON_SKIPPED } from "../cron.mjs";
export { decideAcquire, decideRelease, lockHealth } from "./core.mjs";
export type { LockRecord, AcquireDecision } from "./core.mjs";

export const TICKER_INTERVAL_MS: number;
interface Namespace<T> {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): T;
}
/** Run `fn` holding the lease `name`, or CRON_SKIPPED when another run holds it; releases only its own token. */
export function withLease<T>(
  ns: Namespace<{
    acquire(leaseMs: number): Promise<string | null>;
    release(token: string): Promise<void>;
  }>,
  name: string,
  leaseMs: number,
  fn: () => Promise<T>,
): Promise<T | typeof CRON_SKIPPED>;
/** Set the alarm only if none is set; true when it set one. */
export function armIfIdle(
  storage: { getAlarm(): Promise<number | null>; setAlarm(at: number): Promise<void> },
  intervalMs?: number,
  now?: number,
): Promise<boolean>;
/** The alarm: re-arm first, then run, swallowing (and logging) the run's throw. */
export function tick(
  storage: { setAlarm(at: number): Promise<void> },
  run: () => Promise<unknown>,
  intervalMs?: number,
  now?: number,
): Promise<void>;
/** Make sure the ticker named `name` has its alarm set; never throws. */
export function ensureTickerArmed(
  ns: Namespace<{ ensureArmed(): Promise<boolean> }> | undefined,
  name: string,
): Promise<void>;
