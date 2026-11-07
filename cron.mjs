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
 * - RUN NOW: runJobNow runs one job by name through the same path, and runJobTool serves it as the operator tool
 *   `run_job`, so a job is never run by hand through a second copy of its work (Dustin 2026-11-07, "can you just run
 *   them now"). A job marked `backup` is one Capsid Admin's back up now runs.
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
 * @typedef {{ name: string, everyMinutes: number, timeoutMs?: number, holdOnTimeout?: boolean, backup?: boolean, run: (signal: AbortSignal) => Promise<unknown> }} CronJob
 * @typedef {{ job: string, status: "ok" | "skipped" | "failed", ms: number, result?: unknown, error?: string }} CronOutcome
 */

/**
 * The writer runJob records through: `db` resolved once, on the first write, so a missing binding is logged and the
 * job still runs. Null records nothing (a Worker with no D1, such as an admin MCP server): the log lines still go out.
 * @param {D1Like | (() => D1Like) | null} db
 * @returns {(sql: string, ...values: unknown[]) => Promise<void>}
 */
function recorder(db) {
  /** @type {D1Like | undefined} */
  let store;
  return async (sql, ...values) => {
    if (db === null) return;
    try {
      store ??= typeof db === "function" ? db() : db;
      await store
        .prepare(sql)
        .bind(...values)
        .run();
    } catch (error) {
      logEvent("cron_run_write_failed", { name: values[0], error }, { level: "error" });
    }
  };
}

/** The longest result runJob hands back, as JSON: a job's summary, never its data. */
export const CRON_RESULT_MAX = 4000;

/** @param {unknown} value */
function resultOf(value) {
  if (value === undefined || value === null) return undefined;
  try {
    const text = JSON.stringify(value);
    if (text === undefined) return undefined;
    return text.length <= CRON_RESULT_MAX
      ? JSON.parse(text)
      : `(${text.length} characters, not shown)`;
  } catch {
    return undefined;
  }
}

/**
 * One job, run the way runJobs runs each: recorded in `cron_runs`, raced against its timeout, its signal aborted then,
 * held to its end when it holds on timeout. Never throws: it answers what the run came to, with the job's own result
 * (cut to CRON_RESULT_MAX as JSON) on a success and the stored error on a failure.
 * @param {(sql: string, ...values: unknown[]) => Promise<void>} write
 * @param {CronJob} job
 * @param {{ now: () => number, timeoutMs: number }} options
 * @returns {Promise<CronOutcome>}
 */
async function runOne(
  write,
  { name, everyMinutes, run, timeoutMs: own, holdOnTimeout },
  { now, timeoutMs },
) {
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
    const value = await Promise.race([work, timeout]);
    const at = now();
    if (value === CRON_SKIPPED) {
      logEvent("cron_job_skipped", { name, ms: at - started });
      return { job: name, status: "skipped", ms: at - started };
    }
    logEvent("cron_job_ok", { name, ms: at - started });
    await write(OK, name, everyMinutes, at);
    const result = resultOf(value);
    return {
      job: name,
      status: "ok",
      ms: at - started,
      ...(result === undefined ? {} : { result }),
    };
  } catch (error) {
    const at = now();
    logEvent("cron_job_failed", { name, ms: at - started, error }, { level: "error" });
    const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const stored = scrubText(text).slice(0, CRON_ERROR_MAX);
    await write(FAILED, name, everyMinutes, at, stored);
    // Held past its timeout: recorded failed above, and waited for here, whatever it ends with.
    if (holdOnTimeout && controller.signal.aborted) {
      await work.catch(() => undefined);
      logEvent("cron_job_overran", { name, ms: now() - started }, { level: "error" });
    }
    return { job: name, status: "failed", ms: at - started, error: stored };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs `jobs` in turn, each isolated, recording each in `cron_runs`; throws one Error naming the jobs that failed.
 * `db` may be a function, called once, so a missing binding is logged and the jobs still run, or null to record nothing.
 * @param {D1Like | (() => D1Like) | null} db
 * @param {CronJob[]} jobs
 * @param {{ now?: () => number, timeoutMs?: number }} [options] the clock in epoch ms (default Date.now), and each job's
 *   timeout unless the job sets its own (default CRON_TIMEOUT_MS)
 * @returns {Promise<CronOutcome[]>} what each run came to, when none failed
 */
export async function runJobs(db, jobs, { now = Date.now, timeoutMs = CRON_TIMEOUT_MS } = {}) {
  const write = recorder(db);
  /** @type {CronOutcome[]} */
  const outcomes = [];
  for (const job of jobs) outcomes.push(await runOne(write, job, { now, timeoutMs }));
  const failed = outcomes.filter((o) => o.status === "failed").map((o) => o.job);
  if (failed.length) throw new Error(`cron jobs failed: ${failed.join(", ")}`);
  return outcomes;
}

/**
 * RUN NOW: one of the site's jobs, by name, through the code its trigger runs (runJobs: the same `cron_runs` record
 * /health reads, the same timeout), at once instead of at its hour. Never throws for a failed run: it answers the
 * outcome, so the caller sees the job's error. An unknown name throws, naming the jobs there are.
 * @param {D1Like | (() => D1Like) | null} db
 * @param {CronJob[]} jobs every job the site's triggers run
 * @param {string} name
 * @param {{ now?: () => number, timeoutMs?: number }} [options]
 * @returns {Promise<CronOutcome>}
 */
export async function runJobNow(
  db,
  jobs,
  name,
  { now = Date.now, timeoutMs = CRON_TIMEOUT_MS } = {},
) {
  const job = jobs.find((j) => j.name === name);
  if (!job)
    throw new Error(
      `No job named '${name}'. Jobs: ${jobs.map((j) => j.name).join(", ") || "none"}.`,
    );
  logEvent("cron_job_run_now", { name });
  return runOne(recorder(db), job, { now, timeoutMs });
}

/**
 * The operator tool `run_job` (./operator), the one way any site's job is run by hand: `{ job: "<name>" }` runs that
 * job, `{ backup: true }` runs every job marked `backup` in turn (Capsid Admin's back up now). Each through runJobNow,
 * so what /health reads is what the cron would have written. Answers `{ runs: [outcome] }`; a failed run is an outcome,
 * not a thrown error, so its message reaches the caller whole.
 * @param {D1Like | (() => D1Like) | null} db
 * @param {CronJob[] | (() => CronJob[])} jobs every job the site's triggers run, or a function giving them (called per call)
 * @param {{ now?: () => number, timeoutMs?: number }} [options]
 * @returns {import("./operator.d.mts").OperatorTool}
 */
export function runJobTool(db, jobs, options = {}) {
  const list = () => (typeof jobs === "function" ? jobs() : jobs);
  return {
    description:
      "Runs one of the site's scheduled jobs now, through the code its cron runs, recorded in cron_runs as the cron " +
      `would record it: args { job: "<name>" }, or { backup: true } for every backup job. Jobs: ${list()
        .map((j) => j.name + (j.backup ? " (backup)" : ""))
        .join(
          ", ",
        )}. Answers { runs: [{ job, status: ok | skipped | failed, ms, result?, error? }] }.`,
    run: async (args) => {
      const all = list();
      if (args.backup === true && args.job === undefined) {
        const backups = all.filter((j) => j.backup);
        if (!backups.length) throw new Error("This site marks no job as a backup.");
        /** @type {CronOutcome[]} */
        const runs = [];
        for (const job of backups) runs.push(await runJobNow(db, all, job.name, options));
        return { runs };
      }
      if (typeof args.job !== "string" || args.backup !== undefined)
        throw new Error('Send { job: "<name>" } or { backup: true }.');
      return { runs: [await runJobNow(db, all, args.job, options)] };
    },
  };
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
    .prepare(
      "SELECT name, every_minutes, first_started_at, last_ok_at, last_failed_at FROM cron_runs ORDER BY name",
    )
    .bind()
    .all();
  const rows = new Map(
    /** @type {Array<Record<string, number | string | null>>} */ (results).map((row) => [
      String(row.name),
      row,
    ]),
  );
  const expected =
    jobs ??
    [...rows.values()].map((row) => ({
      name: String(row.name),
      everyMinutes: Number(row.every_minutes),
    }));
  /** @type {Array<{ name: string, reason: "failed" | "stale" | "never succeeded" | "never ran", lastOkAt: number | null }>} */
  const found = [];
  for (const { name, everyMinutes } of expected) {
    const limit = windowMs(everyMinutes);
    const row = rows.get(name);
    if (!row) {
      if (deployedAt === undefined || at - deployedAt.getTime() > limit)
        found.push({ name, reason: "never ran", lastOkAt: null });
      continue;
    }
    const ok = row.last_ok_at === null ? null : Number(row.last_ok_at);
    const failedAt = row.last_failed_at === null ? null : Number(row.last_failed_at);
    if (failedAt !== null && (ok === null || failedAt > ok))
      found.push({ name, reason: "failed", lastOkAt: ok });
    else if (ok !== null && at - ok > limit) found.push({ name, reason: "stale", lastOkAt: ok });
    else if (
      ok === null &&
      row.first_started_at !== null &&
      at - Number(row.first_started_at) > limit
    )
      found.push({ name, reason: "never succeeded", lastOkAt: null });
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
      return found.length
        ? { ok: false, detail: found.map(({ name, reason }) => `${name} ${reason}`).join(", ") }
        : true;
    },
  };
}
