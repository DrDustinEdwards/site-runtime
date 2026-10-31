/** A site's scheduled jobs, each isolated, recorded in D1 `cron_runs`, and the /health check that notices one stopped (cron.mjs). */

/** The longest error stored: 500. */
export const CRON_ERROR_MAX: number;
/** How long a job may run before it is recorded failed and the next starts: 300000 (five minutes). */
export const CRON_TIMEOUT_MS: number;
/** The migration: `cron_runs` (name, every_minutes, first_started_at, last_started_at, last_ok_at, last_failed_at, last_error; epoch ms). */
export const CRON_SQL: string;

/** The part of a D1 binding this uses. */
export interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): { run(): Promise<unknown>; all(): Promise<{ results: unknown[] }> };
  };
}

/**
 * One job: `everyMinutes` is how often its trigger fires; `timeoutMs` overrides runJobs' timeout for it. `run` gets a
 * signal that is aborted when the job times out.
 */
export interface CronJob {
  name: string;
  everyMinutes: number;
  timeoutMs?: number;
  run: (signal: AbortSignal) => Promise<unknown>;
}

/**
 * Runs `jobs` in turn, each isolated and raced against its timeout (the job's `timeoutMs`, else `options.timeoutMs`,
 * default CRON_TIMEOUT_MS; a timed-out job is recorded failed and the next runs), logging cron_job_ok or
 * cron_job_failed and recording each in `cron_runs`; a failed record write is logged and the job still runs. Throws one
 * Error naming the failed jobs after the last one.
 */
export function runJobs(db: D1Like | (() => D1Like), jobs: CronJob[], options?: { now?: () => number; timeoutMs?: number }): Promise<void>;

/**
 * The /health check (name "cron", level warn): fails, naming the jobs, when a job's last run failed, its last success is
 * older than its interval + the grace (`graceMinutes`, default the larger of 10 and a tenth of the interval), or it never
 * succeeded and was first started longer ago. Given `jobs`, only those are read, and one with no row fails "never ran"
 * once its window has passed since `deployedAt` (at once without it).
 */
export function cronCheck(
  db: D1Like | (() => D1Like),
  options?: { graceMinutes?: number; jobs?: Array<{ name: string; everyMinutes: number }>; deployedAt?: Date; now?: Date },
): { name: "cron"; level: "warn"; run: () => Promise<true | { ok: false; detail: string }> };
