/**
 * A site's scheduled jobs, run so that one failure never stops the next, with each job's last start, success and
 * failure in the site's D1 (`cron_runs`), so /health can say when a cron failed or stopped.
 *
 * - Each job runs in turn, isolated: a throw is caught, logged (`cron_job_failed`, with its name and ms) and stored in
 *   `last_error`, scrubbed and cut to CRON_ERROR_MAX characters, and the next job still runs. A success logs `cron_job_ok`.
 * - Each job is raced against its timeout (`timeoutMs` on the job, else runJobs' `timeoutMs`, CRON_TIMEOUT_MS by
 *   default). A job that runs past it is recorded as failed ("timed out after N ms") and the next job starts, so one hung
 *   job never holds up the rest of its trigger. Its signal is aborted then, so a job that takes it can stop its work.
 *   A job with `holdOnTimeout` (one holding a lock, or moving money) is recorded failed at its timeout the same way,
 *   but the runner waits for it to end before the next job starts, and its late end records no success: letting the
 *   next job start beside it, or the invocation end under it, would cut a money write in half.
 * - A job whose run resolves to CRON_SKIPPED (a gate of its own said not now: switched off, not due, locked) is logged
 *   `cron_job_skipped` and records no success it never had.
 * - A failed write to `cron_runs` is logged (`cron_run_write_failed`) and the job still runs: the record serves the job,
 *   not the other way round.
 * - After the last job, if any failed, `runJobs` throws one Error naming them, so Cloudflare marks the invocation failed.
 * - `cronCheck` is the /health check (level warn) that fails when a job's last run failed, its last success is older than
 *   its own interval plus a grace (the larger of 10 minutes and a tenth of the interval), or, given the site's jobs, a job
 *   has never run at all (a trigger that never fires it), so an outside probe of /health notices a cron that stopped.
 */

import { logEvent, scrubText } from "./log.mjs";

/** The longest error stored. */
export const CRON_ERROR_MAX = 500;

/** How long a job may run before runJobs records it failed and starts the next: five minutes. */
export const CRON_TIMEOUT_MS = 5 * 60_000;

/** The migration: a D1 site adds it as its next file under `migrations/`. Times are epoch milliseconds. */
export const CRON_SQL = `CREATE TABLE IF NOT EXISTS cron_runs (
  name TEXT PRIMARY KEY NOT NULL,
  every_minutes INTEGER NOT NULL,
  first_started_at INTEGER,
  last_started_at INTEGER,
  last_ok_at INTEGER,
  last_failed_at INTEGER,
  last_error TEXT
);
`;

/** What a job's run resolves to when its own gate skipped it: no success is recorded. */
export const CRON_SKIPPED = Symbol.for("site-runtime.cron.skipped");

const STARTED = `INSERT INTO cron_runs (name, every_minutes, first_started_at, last_started_at) VALUES (?1, ?2, ?3, ?3)
ON CONFLICT (name) DO UPDATE SET every_minutes = excluded.every_minutes, last_started_at = excluded.last_started_at`;
const OK = `INSERT INTO cron_runs (name, every_minutes, last_ok_at) VALUES (?1, ?2, ?3)
ON CONFLICT (name) DO UPDATE SET last_ok_at = excluded.last_ok_at, last_error = NULL`;
const FAILED = `INSERT INTO cron_runs (name, every_minutes, last_failed_at, last_error) VALUES (?1, ?2, ?3, ?4)
ON CONFLICT (name) DO UPDATE SET last_failed_at = excluded.last_failed_at, last_error = excluded.last_error`;

/**
 * @typedef {{ prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown>, all(): Promise<{ results: unknown[] }> } } }} D1Like
 * @typedef {{ name: string, everyMinutes: number, timeoutMs?: number, holdOnTimeout?: boolean, run: (signal: AbortSignal) => Promise<unknown> }} CronJob
 */

/**
 * Runs `jobs` in turn, each isolated, recording each in `cron_runs`; throws one Error naming the jobs that failed.
 * `db` may be a function, called once, so a missing binding is logged and the jobs still run.
 * @param {D1Like | (() => D1Like)} db
 * @param {CronJob[]} jobs
 * @param {{ now?: () => number, timeoutMs?: number }} [options] the clock in epoch ms (default Date.now), and each job's
 *   timeout unless the job sets its own (default CRON_TIMEOUT_MS)
 * @returns {Promise<void>}
 */
export async function runJobs(db, jobs, { now = Date.now, timeoutMs = CRON_TIMEOUT_MS } = {}) {
  /** @type {D1Like | undefined} */
  let store;
  /** @type {(sql: string, ...values: unknown[]) => Promise<void>} */
  const write = async (sql, ...values) => {
    try {
      store ??= typeof db === "function" ? db() : db;
      await store.prepare(sql).bind(...values).run();
    } catch (error) {
      logEvent("cron_run_write_failed", { name: values[0], error }, { level: "error" });
    }
  };
  /** @type {string[]} */
  const failed = [];
  for (const { name, everyMinutes, run, timeoutMs: own, holdOnTimeout } of jobs) {
    const started = now();
    await write(STARTED, name, everyMinutes, started);
    const limit = own ?? timeoutMs;
    const controller = new AbortController();
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const work = Promise.resolve().then(() => run(controller.signal));
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`timed out after ${limit} ms`);
          controller.abort(error);
          reject(error);
        }, limit);
      });
      const result = await Promise.race([work, timeout]);
      const at = now();
      if (result === CRON_SKIPPED) {
        logEvent("cron_job_skipped", { name, ms: at - started });
      } else {
        logEvent("cron_job_ok", { name, ms: at - started });
        await write(OK, name, everyMinutes, at);
      }
    } catch (error) {
      const at = now();
      failed.push(name);
      logEvent("cron_job_failed", { name, ms: at - started, error }, { level: "error" });
      const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      await write(FAILED, name, everyMinutes, at, scrubText(text).slice(0, CRON_ERROR_MAX));
      // Held past its timeout: recorded failed above, and waited for here, whatever it ends with.
      if (holdOnTimeout && controller.signal.aborted) {
        await work.catch(() => undefined);
        logEvent("cron_job_overran", { name, ms: now() - started }, { level: "error" });
      }
    } finally {
      clearTimeout(timer);
    }
  }
  if (failed.length) throw new Error(`cron jobs failed: ${failed.join(", ")}`);
}

/**
 * Each job in `cron_runs` that is not well, as data: the reason is "failed" (its last run failed), "stale" (its last
 * success is older than its interval plus the grace), "never succeeded" (first started longer ago than that, no
 * success) or "never ran" (given `jobs`, no row once its window has passed since `deployedAt`, at once without it).
 * `lastOkAt` is the last success in epoch ms, or null. The grace is `graceMinutes` when given, else the larger of
 * 10 minutes and a tenth of the interval. cronCheck is built on it; a site that mails its own alert reads it.
 * @param {D1Like | (() => D1Like)} db
 * @param {{ graceMinutes?: number, jobs?: Array<{ name: string, everyMinutes: number }>, deployedAt?: Date, now?: Date }} [options]
 * @returns {Promise<Array<{ name: string, reason: "failed" | "stale" | "never succeeded" | "never ran", lastOkAt: number | null }>>}
 */
export async function cronFindings(db, { graceMinutes, jobs, deployedAt, now } = {}) {
  /** @param {number} every */
  const windowMs = (every) => (every + (graceMinutes ?? Math.max(10, every / 10))) * 60_000;
  const at = now?.getTime() ?? Date.now();
  const { results } = await (typeof db === "function" ? db() : db)
    .prepare("SELECT name, every_minutes, first_started_at, last_ok_at, last_failed_at FROM cron_runs ORDER BY name")
    .bind()
    .all();
  const rows = new Map(/** @type {Array<Record<string, number | string | null>>} */ (results).map((row) => [String(row.name), row]));
  const expected = jobs ?? [...rows.values()].map((row) => ({ name: String(row.name), everyMinutes: Number(row.every_minutes) }));
  /** @type {Array<{ name: string, reason: "failed" | "stale" | "never succeeded" | "never ran", lastOkAt: number | null }>} */
  const found = [];
  for (const { name, everyMinutes } of expected) {
    const limit = windowMs(everyMinutes);
    const row = rows.get(name);
    if (!row) {
      if (deployedAt === undefined || at - deployedAt.getTime() > limit) found.push({ name, reason: "never ran", lastOkAt: null });
      continue;
    }
    const ok = row.last_ok_at === null ? null : Number(row.last_ok_at);
    const failedAt = row.last_failed_at === null ? null : Number(row.last_failed_at);
    if (failedAt !== null && (ok === null || failedAt > ok)) found.push({ name, reason: "failed", lastOkAt: ok });
    else if (ok !== null && at - ok > limit) found.push({ name, reason: "stale", lastOkAt: ok });
    else if (ok === null && row.first_started_at !== null && at - Number(row.first_started_at) > limit) found.push({ name, reason: "never succeeded", lastOkAt: null });
  }
  return found;
}

/**
 * The /health check for the jobs in `cron_runs` (name "cron", level warn): cronFindings, named in its detail. It
 * fails when a job's last run failed, its last success is older than its interval plus the grace, or it has never
 * succeeded and was first started longer ago than that. Given `jobs` (the list the site passes runJobs), it reads only
 * those, with their own intervals, so a removed job's old row is ignored, and a job with no row at all fails as
 * "never ran" once its window has passed since `deployedAt` (at once when that is not given).
 * @param {D1Like | (() => D1Like)} db
 * @param {{ graceMinutes?: number, jobs?: Array<{ name: string, everyMinutes: number }>, deployedAt?: Date, now?: Date }} [options]
 * @returns {{ name: "cron", level: "warn", run: () => Promise<true | { ok: false, detail: string }> }}
 */
export function cronCheck(db, options = {}) {
  return {
    name: "cron",
    level: "warn",
    run: async () => {
      const found = await cronFindings(db, options);
      return found.length ? { ok: false, detail: found.map(({ name, reason }) => `${name} ${reason}`).join(", ") } : true;
    },
  };
}
