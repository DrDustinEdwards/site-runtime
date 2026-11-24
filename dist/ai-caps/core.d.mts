/**
 * The part of a Durable Object's `ctx.storage.sql` the budget uses.
 * @typedef {{ exec(query: string, ...bindings: unknown[]): { toArray(): Array<Record<string, unknown>> }; }} SqlLike
 */
/**
 * The window a use is counted in, as the key it is stored under: the UTC date, or the UTC month.
 * @param {"day" | "month"} window
 * @param {Date} now
 */
export function windowKey(window: "day" | "month", now: Date): string;
/**
 * Make the table. The name and columns are dustinedwards.info's, so its stored counts carry over.
 * @param {SqlLike} sql
 */
export function ensureBudgetTable(sql: SqlLike): void;
/**
 * Count one use in the window `key` unless `limit` is already reached, and forget every other window.
 * @param {SqlLike} sql
 * @param {string} key
 * @param {number} limit
 * @returns {{ ok: boolean, spent: number }}
 */
export function consume(sql: SqlLike, key: string, limit: number): {
    ok: boolean;
    spent: number;
};
/**
 * What the window `key` has spent, counting nothing.
 * @param {SqlLike} sql
 * @param {string} key
 * @returns {number}
 */
export function spent(sql: SqlLike, key: string): number;
/** @param {SqlLike} sql */
export function resetBudget(sql: SqlLike): void;
/**
 * The part of a Durable Object's `ctx.storage.sql` the budget uses.
 */
export type SqlLike = {
    exec(query: string, ...bindings: unknown[]): {
        toArray(): Array<Record<string, unknown>>;
    };
};
