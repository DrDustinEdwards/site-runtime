/** @typedef {import("./sign-in-account.mjs").D1Like} D1Like */
/**
 * Deletes rows with no user after 30 days and every row after a year: a site runs it as a daily job (`./cron`).
 * Deleting an account deletes that person's rows at once (`./sign-in`).
 * @param {D1Like} db @param {number} [now]
 */
export function pruneAuthEvents(db: D1Like, now?: number): Promise<void>;
/**
 * Deletes Better Auth's expired sessions and expired one-time values (links, codes, email-change tokens), which it
 * never deletes itself, and its sign-in rate-limit counts a day after their last request (the `rate_limit` table, on
 * sites that have one). The same cleanup as EmDash 1.4.0 (emdash-cms/emdash#4287, MIT). The tables are `session` and
 * `verification`, with `expires_at` in ms.
 * @param {D1Like} db @param {number} [now]
 */
export function pruneExpiredAuth(db: D1Like, now?: number): Promise<void>;
/**
 * The nightly job that runs pruneAuthEvents and pruneExpiredAuth, named "prune-auth-events" on every site (one minute).
 * @param {D1Like} db
 * @returns {import("./cron.mjs").CronJob}
 */
export function pruneAuthEventsJob(db: D1Like): import("./cron.mjs").CronJob;
export type D1Like = import("./sign-in-account.mjs").D1Like;
