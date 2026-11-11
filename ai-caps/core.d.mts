/** The part of a Durable Object's `ctx.storage.sql` the budget uses. */
export interface SqlLike {
  exec(query: string, ...bindings: unknown[]): { toArray(): Array<Record<string, unknown>> };
}
/** The window's key: the UTC date (`2026-11-11`) or month (`2026-11`). */
export function windowKey(window: "day" | "month", now: Date): string;
/** Make the `budget` table (day TEXT PRIMARY KEY, count INTEGER). */
export function ensureBudgetTable(sql: SqlLike): void;
/** Count one use in window `key` unless `limit` is reached; forgets every other window. Synchronous, so it is atomic. */
export function consume(sql: SqlLike, key: string, limit: number): { ok: boolean; spent: number };
/** What window `key` has spent, counting nothing. */
export function spent(sql: SqlLike, key: string): number;
/** Forget every window. */
export function resetBudget(sql: SqlLike): void;
