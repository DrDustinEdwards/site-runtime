/**
 * A site's scheduled jobs, run so that one failure never stops the next, with each job's last start, success and
 * failure in the site's D1 (`cron_runs`), so /health can say when a cron failed or stopped.
 *
 * - Each job runs in turn, isolated: a throw is caught, logged (`cron_job_failed`) and stored in `last_error`,
 *   scrubbed and cut to CRON_ERROR_MAX characters. A success logs `cron_job_ok`.
 * - Each job is raced against its timeout (`timeoutMs` on the job, else runJobs' `timeoutMs`, CRON_TIMEOUT_MS by
 *   default): past it the job is recorded failed ("timed out after N ms"), its signal aborted, and the next job
 *   starts. A job with `holdOnTimeout` (holding a lock, or moving money) is recorded failed the same way, but the
 *   runner waits for it to end before the next job, and its late end records no success: a money write is never cut
 *   in half.
 * - A job resolving to CRON_SKIPPED (its own gate said not now) is logged `cron_job_skipped`, with no success.
 * - A failed write to `cron_runs` is logged (`cron_run_write_failed`) and the job still runs.
 * - After the last job, if any failed, `runJobs` throws one Error naming them, so Cloudflare marks the invocation failed.
 * - RUN NOW: runJobNow runs one job by name through the same path, and runJobTool serves it as the operator tool
 *   `run_job`, so a job is never run by hand through a second copy of its work. A job marked
 *   `backup` is one Capsid Admin's back up now runs.
 * - HISTORY (opt in, `runJobs(db, jobs, { history })`): each run that came to something is also appended to
 *   `cron_run_log` (CRON_LOG_SQL), the newest few kept per job (trimmed about hourly for a job that runs more often). A job may resolve `{ outcome: "ok" | "refused" |
 *   "skipped", reason }`: `ok` records the reason, `refused` records a failure without throwing, `skipped` records
 *   nothing. readCronRuns reads the runs back and cronStates decides each job's flag (failing, quiet, never).
 * - EVENT JOBS: `everyMinutes: null` is a job whose runs come and go with the work. It has no stale window, so it
 *   is flagged only by a failure inside the last day.
 * - `cronCheck` is the /health check (level warn) that fails when a job's last run failed, its last success is older
 *   than its interval plus a grace (the larger of 10 minutes and a tenth of the interval), or, given the site's
 *   jobs, a job has never run.
 */

import { isDatabaseDown, logEvent, scrubText } from "./log.mjs";
import { withTimeout } from "./time.mjs";

export {
  CRON_EVENT_WINDOW_MS,
  cronCheck,
  cronFindings,
  cronStates,
  readCronRuns,
} from "./cron-status.mjs";

/**
 * Why a job in `cron_runs` is not well, with its last success (epoch ms) or null.
 * @typedef {object} CronFinding
 * @property {string} name
 * @property {"failed" | "stale" | "never succeeded" | "never ran"} reason
 * @property {number | null} lastOkAt
 */

/**
 * What cronFindings and cronCheck read: the grace, the site's own list of jobs, when it was deployed, the clock.
 * @typedef {object} CronFindingsOptions
 * @property {number | ((everyMinutes: number) => number)} [graceMinutes] Minutes past a job's interval, or a function of the interval in minutes.
 * @property {Array<{ name: string; everyMinutes: number | null }>} [jobs]
 * @property {Date} [deployedAt]
 * @property {Date} [now]
 */

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

/** The migration for the opt-in history (`runJobs(..., { history })`): one row per recorded run. Times are epoch milliseconds. */
export const CRON_LOG_SQL = `CREATE TABLE IF NOT EXISTS cron_run_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS cron_run_log_name ON cron_run_log (name, id);
`;

const CRON_REASON_MAX = 300;

/** What a job's run resolves to when its own gate skipped it: no success is recorded. */
export const CRON_SKIPPED = Symbol.for("site-runtime.cron.skipped");

const STARTED = `INSERT INTO cron_runs (name, every_minutes, first_started_at, last_started_at) VALUES (?1, ?2, ?3, ?3)
ON CONFLICT (name) DO UPDATE SET every_minutes = excluded.every_minutes, last_started_at = excluded.last_started_at`;
const LOGGED = `INSERT INTO cron_run_log (name, started_at, finished_at, outcome, reason) VALUES (?1, ?2, ?3, ?4, ?5)`;
const PRUNED = `DELETE FROM cron_run_log WHERE name = ?1 AND (finished_at < ?2
  OR id NOT IN (SELECT id FROM cron_run_log WHERE name = ?1 ORDER BY id DESC LIMIT ?3))`;
const OK = `INSERT INTO cron_runs (name, every_minutes, last_ok_at) VALUES (?1, ?2, ?3)
ON CONFLICT (name) DO UPDATE SET last_ok_at = excluded.last_ok_at, last_error = NULL`;
const FAILED = `INSERT INTO cron_runs (name, every_minutes, last_failed_at, last_error) VALUES (?1, ?2, ?3, ?4)
ON CONFLICT (name) DO UPDATE SET last_failed_at = excluded.last_failed_at, last_error = excluded.last_error`;

/**
 * @typedef {{ prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown>, all(): Promise<{ results: unknown[] }> } } }} D1Like
 * @typedef {{ name: string, everyMinutes: number | null, timeoutMs?: number, holdOnTimeout?: boolean, backup?: boolean, run: (signal: AbortSignal, run: { startedAt: number }) => Promise<unknown> }} CronJob
 * @typedef {{ job: string, status: "ok" | "skipped" | "failed" | "refused", ms: number, result?: unknown, reason?: string, error?: string, down?: boolean }} CronOutcome
 * @typedef {{ keep?: number, retentionDays?: number }} CronHistory
 * @typedef {{ now?: () => number, timeoutMs?: number, history?: boolean | CronHistory }} CronOptions
 */

/** @param {string} text */
function oneLine(text) {
  const line = scrubText(text.replace(/\s+/g, " ").trim());
  return line.length > CRON_REASON_MAX ? `${line.slice(0, CRON_REASON_MAX - 1)}…` : line;
}

/**
 * What a run resolved to, once history is on: `{ outcome, reason }` from a job that says what it did, else a plain ok.
 * @param {unknown} value
 * @returns {{ outcome: "ok" | "refused" | "skipped", reason: string, told: boolean }} `told`: the job said it itself
 */
function verdictOf(value) {
  if (value === CRON_SKIPPED) return { outcome: "skipped", reason: "", told: true };
  if (typeof value === "object" && value !== null && "outcome" in value) {
    const { outcome, reason } = /** @type {{ outcome: unknown, reason?: unknown }} */ (value);
    if (outcome === "ok" || outcome === "refused" || outcome === "skipped")
      return { outcome, reason: typeof reason === "string" ? oneLine(reason) : "", told: true };
  }
  return { outcome: "ok", reason: "", told: false };
}

/**
 * Whether this run also trims its job's history. The trim reads every row the job has kept, so a job that runs more
 * than once an hour trims on the one run that starts in the first `every` minutes of the hour (about once an hour,
 * the table holding a few rows over `keep` meanwhile); an hourly or rarer job, and an event job, trims on every run.
 * @param {number} startedAt epoch ms
 * @param {number} every minutes, 0 for an event job
 */
function trimDue(startedAt, every) {
  if (every === 0 || every >= 60) return true;
  return Math.floor(startedAt / 60_000) % 60 < every;
}

/**
 * @param {boolean | CronHistory | undefined} history
 * @returns {{ keep: number, retentionDays: number } | null}
 */
function historyOf(history) {
  if (!history) return null;
  const { keep = 5, retentionDays = 14 } = history === true ? {} : history;
  return { keep, retentionDays };
}

/**
 * The writer runJob records through: `db` resolved once, on the first write, so a missing binding is logged and the
 * job still runs. Null records nothing (a Worker with no D1): the log lines still go out.
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
      // D1 down for a moment is a warning; a database that stays down still fails the cron and database checks.
      logEvent(
        "cron_run_write_failed",
        { name: values[0], error },
        { level: isDatabaseDown(error) ? "warn" : "error" },
      );
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
 * One job, run the way runJobs runs each. Never throws: it answers what the run came to, with the job's own result
 * (cut to CRON_RESULT_MAX as JSON) on a success and the stored error on a failure.
 * @param {(sql: string, ...values: unknown[]) => Promise<void>} write
 * @param {CronJob} job
 * @param {{ now: () => number, timeoutMs: number, history: { keep: number, retentionDays: number } | null }} options
 * @returns {Promise<CronOutcome>}
 */
async function runOne(
  write,
  { name, everyMinutes, run, timeoutMs: own, holdOnTimeout },
  { now, timeoutMs, history },
) {
  const started = now();
  const every = everyMinutes ?? 0;
  await write(STARTED, name, every, started);
  /**
   * The history row and its bounded prune, when history is on.
   * @param {number} at
   * @param {string} outcome
   * @param {string} reason
   */
  const log = async (at, outcome, reason) => {
    if (!history) return;
    await write(LOGGED, name, started, at, outcome, reason);
    if (!trimDue(started, every)) return;
    await write(PRUNED, name, at - history.retentionDays * 86_400_000, history.keep);
  };
  const limit = own ?? timeoutMs;
  const controller = new AbortController();
  const work = Promise.resolve().then(() => run(controller.signal, { startedAt: started }));
  try {
    const value = await withTimeout(work, limit, undefined, (error) => controller.abort(error));
    const at = now();
    const verdict = history
      ? verdictOf(value)
      : { outcome: value === CRON_SKIPPED ? "skipped" : "ok", reason: "", told: false };
    if (verdict.outcome === "skipped") {
      logEvent("cron_job_skipped", {
        name,
        ms: at - started,
        ...(verdict.reason ? { reason: verdict.reason } : {}),
      });
      return { job: name, status: "skipped", ms: at - started };
    }
    if (verdict.outcome === "refused") {
      logEvent(
        "cron_job_refused",
        { name, ms: at - started, reason: verdict.reason },
        { level: "warn" },
      );
      await write(FAILED, name, every, at, verdict.reason);
      await log(at, "refused", verdict.reason);
      return { job: name, status: "refused", ms: at - started, reason: verdict.reason };
    }
    logEvent("cron_job_ok", { name, ms: at - started });
    await write(OK, name, every, at);
    await log(at, "ok", verdict.reason);
    const result = verdict.told ? undefined : resultOf(value);
    return {
      job: name,
      status: "ok",
      ms: at - started,
      ...(verdict.reason ? { reason: verdict.reason } : {}),
      ...(result === undefined ? {} : { result }),
    };
  } catch (error) {
    const at = now();
    // Read from the error and its causes: the stored text below has lost them. Recorded failed either way; only the level differs.
    const down = isDatabaseDown(error);
    logEvent(
      "cron_job_failed",
      { name, ms: at - started, error },
      { level: down ? "warn" : "error" },
    );
    const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const stored = scrubText(text).slice(0, CRON_ERROR_MAX);
    await write(FAILED, name, every, at, stored);
    await log(at, "failed", oneLine(stored));
    // Held past its timeout: recorded failed above, and waited for here, whatever it ends with.
    if (holdOnTimeout && controller.signal.aborted) {
      await work.catch(() => undefined);
      logEvent("cron_job_overran", { name, ms: now() - started }, { level: "error" });
    }
    return { job: name, status: "failed", ms: at - started, error: stored, down };
  }
}

/**
 * Runs `jobs` in turn, each isolated, recording each in `cron_runs`; throws one Error naming the jobs that failed.
 * `db` may be a function, called once, so a missing binding is logged and the jobs still run, or null to record nothing.
 * @param {D1Like | (() => D1Like) | null} db
 * @param {CronJob[]} jobs
 * @param {CronOptions & { rethrow?: boolean }} [options] the clock in epoch ms (default Date.now), each job's timeout
 *   unless the job sets its own (default CRON_TIMEOUT_MS), `history` (true, or `{ keep: 5, retentionDays: 14 }`) to
 *   also keep each run in `cron_run_log`, and `rethrow: false` for a step inside a larger run, whose failures are
 *   in the outcomes and the record and do not throw (default true)
 * @returns {Promise<CronOutcome[]>} what each run came to, when none failed
 */
export async function runJobs(
  db,
  jobs,
  { now = Date.now, timeoutMs = CRON_TIMEOUT_MS, history, rethrow = true } = {},
) {
  const write = recorder(db);
  const keeping = historyOf(history);
  /** @type {CronOutcome[]} */
  const outcomes = [];
  for (const job of jobs)
    outcomes.push(await runOne(write, job, { now, timeoutMs, history: keeping }));
  // A job that failed because the database was down is recorded and logged as a warning, but does not also fail
  // the invocation (Cloudflare's alerts and Sentry would report it as the site's error).
  const failed = outcomes.filter((o) => o.status === "failed" && !o.down).map((o) => o.job);
  if (failed.length && rethrow) throw new Error(`cron jobs failed: ${failed.join(", ")}`);
  return outcomes;
}

/**
 * RUN NOW: one of the site's jobs, by name, through runJobs (same record, same timeout), at once. A failed run is
 * answered as the outcome, not thrown. An unknown name throws, naming the jobs there are.
 * @param {D1Like | (() => D1Like) | null} db
 * @param {CronJob[]} jobs every job the site's triggers run
 * @param {string} name
 * @param {CronOptions} [options]
 * @returns {Promise<CronOutcome>}
 */
export async function runJobNow(
  db,
  jobs,
  name,
  { now = Date.now, timeoutMs = CRON_TIMEOUT_MS, history } = {},
) {
  const job = jobs.find((j) => j.name === name);
  if (!job)
    throw new Error(
      `No job named '${name}'. Jobs: ${jobs.map((j) => j.name).join(", ") || "none"}.`,
    );
  logEvent("cron_job_run_now", { name });
  return runOne(recorder(db), job, { now, timeoutMs, history: historyOf(history) });
}

/**
 * The operator tool `run_job` (./operator): `{ job: "<name>" }` runs that job, `{ backup: true }` runs every job
 * marked `backup` in turn. Each through runJobNow. Answers `{ runs: [outcome] }`; a failed run is an outcome, not a
 * thrown error.
 * @param {D1Like | (() => D1Like) | null} db
 * @param {CronJob[] | (() => CronJob[])} jobs every job the site's triggers run, or a function giving them (called per call)
 * @param {CronOptions} [options]
 * @returns {import("./operator.mjs").OperatorTool}
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
        )}. Answers { runs: [{ job, status: ok | skipped | failed | refused, ms, result?, reason?, error? }] }.`,
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
 * The operator tool `backup_status` (./operator): the backup state read now, uncached. `files` names the site's
 * file passes beside the D1 dump, so the description says what the answer covers.
 * @param {() => unknown} status the site's backup read (d1-dump's backupHealth over its bucket, as /health's `backup`)
 * @param {{ files?: string[] }} [options]
 * @returns {import("./operator.mjs").OperatorTool}
 */
export function backupStatusTool(status, { files = [] } = {}) {
  const covers =
    files.length === 0
      ? ", and a warning when it is past 26 hours"
      : `${files.length === 1 ? ` and the ${files[0]} files pass` : ` and each files pass (${files.join(", ")})`}` +
        `, with when each last completed, and a warning when ${files.length === 1 ? "either" : "any"} is past 26 hours`;
  return {
    description: `Reads the backup state now, uncached: the newest complete D1 dump's age${covers}. The same read as /health's backup field.`,
    run: () => status(),
  };
}

/**
 * The two operator tools every site's scheduled jobs answer through: `backup_status` (backupStatusTool) and `run_job`
 * (runJobTool), for a site's operatorResponse `tools`. `history` is the site's runJobs history, so a job run now is kept
 * in `cron_run_log` as its trigger keeps it.
 * @param {{ db: D1Like | (() => D1Like) | null, jobs: CronJob[] | (() => CronJob[]), backupStatus: () => unknown, files?: string[], history?: boolean | CronHistory }} options
 * @returns {{ backup_status: import("./operator.mjs").OperatorTool, run_job: import("./operator.mjs").OperatorTool }}
 */
export function operatorJobTools({ db, jobs, backupStatus, files, history }) {
  return {
    backup_status: backupStatusTool(backupStatus, { files }),
    run_job: runJobTool(db, jobs, { history }),
  };
}

/**
 * One line for what a `run_job` call came to (./operator callOperator). `what` names the call ("run_job { backup: true }").
 * @param {string} what
 * @param {{ ok: boolean, status: number, data: unknown, error: string | null }} call
 * @returns {string}
 */
export function describeRuns(what, call) {
  if (!call.ok) return call.error ?? `${what} failed`;
  const runs = /** @type {{ runs?: unknown } | null} */ (call.data)?.runs;
  if (!Array.isArray(runs))
    return `${what} answered ${call.status} without its runs, so nothing was proven`;
  const each = runs.map(
    (/** @type {{ job?: unknown, status?: unknown, ms?: unknown, error?: unknown }} */ r) =>
      `${String(r.job)} ${String(r.status)}${typeof r.ms === "number" ? ` in ${r.ms} ms` : ""}${typeof r.error === "string" ? ` (${r.error})` : ""}`,
  );
  return `${what} ran: ${each.join(", ") || "no jobs"}`;
}

/**
 * Whether a `run_job` answer shows every run succeeded or skipped by its own gate: false for a failed call, an answer
 * without its runs, or any run that failed or was refused (a run that failed without throwing).
 * @param {{ ok: boolean, data: unknown }} call
 * @returns {boolean}
 */
export function runsSucceeded(call) {
  const runs = /** @type {{ runs?: Array<{ status?: unknown }> } | null} */ (call.data)?.runs;
  return (
    call.ok &&
    Array.isArray(runs) &&
    runs.every((r) => r.status !== "failed" && r.status !== "refused")
  );
}

export const DAILY_MINUTES = 1440;

/**
 * The every-minute job that makes Carrel's scheduled changes go live (site-api's schedules), named "carrel-schedules"
 * on every site. 50 seconds by default, so a hung run never runs into the next minute's.
 * @param {(signal: AbortSignal) => Promise<unknown>} run
 * @param {{ timeoutMs?: number }} [options]
 * @returns {CronJob}
 */
export function carrelSchedulesJob(run, { timeoutMs = 50_000 } = {}) {
  return { name: "carrel-schedules", everyMinutes: 1, timeoutMs, run };
}

/**
 * The nightly D1 dump, named "backup" and marked `backup` (Capsid Admin's back up now runs it). Five minutes by
 * default, inside a scheduled invocation's 15 beside the files passes.
 * @param {(signal: AbortSignal) => Promise<unknown>} run
 * @param {{ name?: string, timeoutMs?: number }} [options] `name` for a files pass ("media-backup")
 * @returns {CronJob}
 */
export function backupJob(run, { name = "backup", timeoutMs = 5 * 60_000 } = {}) {
  return { name, backup: true, everyMinutes: DAILY_MINUTES, timeoutMs, run };
}

/**
 * @typedef {{ startedAt: number, finishedAt: number, outcome: "ok" | "refused" | "failed", reason: string }} CronRun
 
 */
