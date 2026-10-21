/** @param {Rule[]} rules */
export function assertRules(rules: Rule[]): void;
/**
 * Seconds left in the window containing `nowMs`, rounded up, so a client that waits that long is
 * in the next window.
 * @param {number} windowIndex
 * @param {number} windowSeconds
 * @param {number} nowMs
 */
export function secondsLeft(windowIndex: number, windowSeconds: number, nowMs: number): number;
/**
 * Counts one use against every rule unless one is spent. When one is spent the answer is that rule's
 * (the one that frees up last, if several), and nothing is written.
 *
 * @param {Sql} sql
 * @param {Rule[]} rules
 * @param {number} nowMs
 * @returns {Hit}
 */
export function hitRules(sql: Sql, rules: Rule[], nowMs: number): Hit;
/**
 * The moment the longest window ends, when an idle instance can forget everything.
 * @param {Rule[]} rules
 * @param {number} nowMs
 */
export function idleDeadline(rules: Rule[], nowMs: number): number;
/**
 * Forgets the windows that have ended and says when the rest end, or null when nothing is left. An
 * alarm that fires early, or against a clock that moved, leaves a live window alone.
 * @param {Sql} sql
 * @param {number} nowMs
 * @returns {number | null}
 */
export function purgeExpired(sql: Sql, nowMs: number): number | null;
/**
 * The counting, apart from the Durable Object so a test can run it on any SQLite. Fixed windows aligned
 * to the epoch, one row per window length. All rules are checked first and none is counted when any is
 * spent, so a refused request costs a read and no write. No `await` anywhere: a Durable Object sequence
 * that spans one is not atomic.
 *
 * @typedef {{ limit: number, windowSeconds: number }} Rule
 * @typedef {{ exec: (query: string, ...bindings: unknown[]) => { toArray: () => any[] } }} Sql
 * @typedef {{ ok: boolean, used: number, limit: number, retryAfterSeconds: number, window: number }} Hit
 */
/**
 * The counting, apart from the Durable Object so a test can run it on any SQLite. Fixed windows aligned
 * to the epoch, one row per window length. All rules are checked first and none is counted when any is
 * spent, so a refused request costs a read and no write. No `await` anywhere: a Durable Object sequence
 * that spans one is not atomic.
 */
export type Rule = {
    limit: number;
    windowSeconds: number;
};
/**
 * The counting, apart from the Durable Object so a test can run it on any SQLite. Fixed windows aligned
 * to the epoch, one row per window length. All rules are checked first and none is counted when any is
 * spent, so a refused request costs a read and no write. No `await` anywhere: a Durable Object sequence
 * that spans one is not atomic.
 */
export type Sql = {
    exec: (query: string, ...bindings: unknown[]) => {
        toArray: () => any[];
    };
};
/**
 * The counting, apart from the Durable Object so a test can run it on any SQLite. Fixed windows aligned
 * to the epoch, one row per window length. All rules are checked first and none is counted when any is
 * spent, so a refused request costs a read and no write. No `await` anywhere: a Durable Object sequence
 * that spans one is not atomic.
 */
export type Hit = {
    ok: boolean;
    used: number;
    limit: number;
    retryAfterSeconds: number;
    window: number;
};
