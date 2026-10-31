/**
 * A site's scheduled jobs, run so that one failure never stops the next, with each job's last start, success and
 * failure in the site's D1 (`cron_runs`), so /health can say when a cron failed or stopped.
 *
 * - Each job runs in turn, isolated: a throw is caught, logged (`cron_job_failed`, with its name and ms) and stored in
 *   `last_error`, scrubbed and cut to CRON_ERROR_MAX characters, and the next job still runs. A success logs `cron_job_ok`.
 * - A failed write to `cron_runs` is logged (`cron_run_write_failed`) and the job still runs: the record serves the job,
 *   not the other way round.
 * - After the last job, if any failed, `runJobs` throws one Error naming them, so Cloudflare marks the invocation failed.
 * - `cronCheck` is the /health check (level warn) that fails when a job's last run failed or it has not succeeded in
 *   2 x its interval plus a grace period, so an outside probe of /health notices a cron that stopped. A job removed from
 *   the site keeps its row, which goes stale: delete the row with the job.
 */

import { logEvent, scrubText } from "./log.mjs";

/** The longest error stored. */
export const CRON_ERROR_MAX = 500;

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

const STARTED = `INSERT INTO cron_runs (name, every_minutes, first_started_at, last_started_at) VALUES (?1, ?2, ?3, ?3)
ON CONFLICT (name) DO UPDATE SET every_minutes = excluded.every_minutes, last_started_at = excluded.last_started_at`;
const OK = `INSERT INTO cron_runs (name, every_minutes, last_ok_at) VALUES (?1, ?2, ?3)
ON CONFLICT (name) DO UPDATE SET last_ok_at = excluded.last_ok_at, last_error = NULL`;
const FAILED = `INSERT INTO cron_runs (name, every_minutes, last_failed_at, last_error) VALUES (?1, ?2, ?3, ?4)
ON CONFLICT (name) DO UPDATE SET last_failed_at = excluded.last_failed_at, last_error = excluded.last_error`;

/**
 * @typedef {{ prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown>, all(): Promise<{ results: unknown[] }> } } }} D1Like
 * @typedef {{ name: string, everyMinutes: number, run: () => Promise<unknown> }} CronJob
 */

/**
 * Runs `jobs` in turn, each isolated, recording each in `cron_runs`; throws one Error naming the jobs that failed.
 * `db` may be a function, called once, so a missing binding is logged and the jobs still run.
 * @param {D1Like | (() => D1Like)} db
 * @param {CronJob[]} jobs
 * @param {{ now?: () => number }} [options] the clock in epoch ms (default Date.now)
 * @returns {Promise<void>}
 */
export async function runJobs(db, jobs, { now = Date.now } = {}) {
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
  for (const { name, everyMinutes, run } of jobs) {
    const started = now();
    await write(STARTED, name, everyMinutes, started);
    try {
      await run();
      const at = now();
      logEvent("cron_job_ok", { name, ms: at - started });
      await write(OK, name, everyMinutes, at);
    } catch (error) {
      const at = now();
      failed.push(name);
      logEvent("cron_job_failed", { name, ms: at - started, error }, { level: "error" });
      const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      await write(FAILED, name, everyMinutes, at, scrubText(text).slice(0, CRON_ERROR_MAX));
    }
  }
  if (failed.length) throw new Error(`cron jobs failed: ${failed.join(", ")}`);
}

/**
 * The /health check for the jobs in `cron_runs` (name "cron", level warn). It fails, naming the jobs, when a job's last
 * run failed, its last success is older than 2 x `every_minutes` + `graceMinutes`, or it has never succeeded and was
 * first started longer ago than that.
 * @param {D1Like | (() => D1Like)} db
 * @param {{ graceMinutes?: number, now?: Date }} [options]
 * @returns {{ name: "cron", level: "warn", run: () => Promise<true | { ok: false, detail: string }> }}
 */
export function cronCheck(db, { graceMinutes = 10, now } = {}) {
  return {
    name: "cron",
    level: "warn",
    run: async () => {
      const at = now?.getTime() ?? Date.now();
      const { results } = await (typeof db === "function" ? db() : db)
        .prepare("SELECT name, every_minutes, first_started_at, last_ok_at, last_failed_at FROM cron_runs ORDER BY name")
        .bind()
        .all();
      /** @type {string[]} */
      const bad = [];
      for (const row of /** @type {Array<Record<string, number | string | null>>} */ (results)) {
        const limit = (2 * Number(row.every_minutes) + graceMinutes) * 60_000;
        const ok = row.last_ok_at === null ? null : Number(row.last_ok_at);
        const failedAt = row.last_failed_at === null ? null : Number(row.last_failed_at);
        if (failedAt !== null && (ok === null || failedAt > ok)) bad.push(`${row.name} failed`);
        else if (ok !== null && at - ok > limit) bad.push(`${row.name} stale`);
        else if (ok === null && row.first_started_at !== null && at - Number(row.first_started_at) > limit) bad.push(`${row.name} never succeeded`);
      }
      return bad.length ? { ok: false, detail: bad.join(", ") } : true;
    },
  };
}
