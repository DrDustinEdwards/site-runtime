/** The caps that keep an AI feature's bill bounded (ai-caps/index.mjs). */
export { windowKey, consume, spent, ensureBudgetTable, resetBudget } from "./core.mjs";
export type { SqlLike } from "./core.mjs";

/** The ceiling to enforce now: `dailyLimit` paced over the UTC day plus `burst`, never above `dailyLimit`. */
export function pacedAllowance(dailyLimit: number, burst: number, now: Date): number;
/** The Retry-After under pacing: a day's seconds over `dailyLimit`, at least 1. */
export function secondsPerPacedUnit(dailyLimit: number): number;

/** The part of a KV namespace a counter uses. */
export interface CounterKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}
/** A soft cap in KV: read-modify-write, so one extra use may slip through. */
export function kvCounter(
  kv: CounterKv,
  prefix: string,
  cap: number | (() => number | Promise<number>),
  options?: { window?: "day" | "month"; ttlSeconds?: number },
): {
  used(now?: Date): Promise<number>;
  limit(): Promise<number>;
  exceeded(now?: Date): Promise<boolean>;
  record(n?: number, now?: Date): Promise<void>;
};

/**
 * Reserve the worst case, run, settle to the real cost. A call that throws keeps its reservation; a failed settle is
 * logged and the reservation stands. `reserve` answers null when the cap is spent: `{ ok: false }`.
 */
export function reserveSettle<T, Slot>(store: {
  reserve: (worst: number) => Promise<Slot | null>;
  settle: (slot: Slot, reserved: number, actual: number) => Promise<void>;
}): (
  worst: number,
  work: () => Promise<{ value: T; actual: number }>,
) => Promise<{ ok: true; value: T; actual: number } | { ok: false }>;
