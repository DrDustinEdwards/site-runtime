// The daily cleanup of what Better Auth and the sign-in log leave behind.
import { DAILY_MINUTES } from "./cron.mjs";

/** @typedef {import("./sign-in-account.mjs").D1Like} D1Like */

/**
 * Deletes rows with no user after 30 days and every row after a year: a site runs it as a daily job (`./cron`).
 * Deleting an account deletes that person's rows at once (`./sign-in`).
 * @param {D1Like} db @param {number} [now]
 */
export async function pruneAuthEvents(db, now = Date.now()) {
  const day = 24 * 60 * 60 * 1000;
  await db
    .prepare("DELETE FROM auth_events WHERE (user_id IS NULL AND at < ?1) OR at < ?2")
    .bind(now - 30 * day, now - 365 * day)
    .run();
}

/**
 * Deletes Better Auth's expired sessions and expired one-time values (links, codes, email-change tokens), which it
 * never deletes itself, and its sign-in rate-limit counts a day after their last request (the `rate_limit` table, on
 * sites that have one). The same cleanup as EmDash 1.4.0 (emdash-cms/emdash#4287, MIT). The tables are `session` and
 * `verification`, with `expires_at` in ms.
 * @param {D1Like} db @param {number} [now]
 */
export async function pruneExpiredAuth(db, now = Date.now()) {
  await db.prepare("DELETE FROM session WHERE expires_at < ?1").bind(now).run();
  await db.prepare("DELETE FROM verification WHERE expires_at < ?1").bind(now).run();
  await db
    .prepare("DELETE FROM rate_limit WHERE last_request < ?1")
    .bind(now - 24 * 60 * 60_000)
    .run()
    .catch((error) => {
      if (!/no such table/i.test(String(error?.message ?? error))) throw error;
    });
}

/**
 * The nightly job that runs pruneAuthEvents and pruneExpiredAuth, named "prune-auth-events" on every site (one minute).
 * @param {D1Like} db
 * @returns {import("./cron.mjs").CronJob}
 */
export function pruneAuthEventsJob(db) {
  return {
    name: "prune-auth-events",
    everyMinutes: DAILY_MINUTES,
    timeoutMs: 60_000,
    run: async () => {
      await pruneAuthEvents(db);
      await pruneExpiredAuth(db);
    },
  };
}
