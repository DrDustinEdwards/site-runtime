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
export function runJobs(db: D1Like | (() => D1Like) | null, jobs: CronJob[], { now, timeoutMs, history, rethrow }?: CronOptions & {
    rethrow?: boolean;
}): Promise<CronOutcome[]>;
/**
 * RUN NOW: one of the site's jobs, by name, through runJobs (same record, same timeout), at once. A failed run is
 * answered as the outcome, not thrown. An unknown name throws, naming the jobs there are.
 * @param {D1Like | (() => D1Like) | null} db
 * @param {CronJob[]} jobs every job the site's triggers run
 * @param {string} name
 * @param {CronOptions} [options]
 * @returns {Promise<CronOutcome>}
 */
export function runJobNow(db: D1Like | (() => D1Like) | null, jobs: CronJob[], name: string, { now, timeoutMs, history }?: CronOptions): Promise<CronOutcome>;
/**
 * The operator tool `run_job` (./operator): `{ job: "<name>" }` runs that job, `{ backup: true }` runs every job
 * marked `backup` in turn. Each through runJobNow. Answers `{ runs: [outcome] }`; a failed run is an outcome, not a
 * thrown error.
 * @param {D1Like | (() => D1Like) | null} db
 * @param {CronJob[] | (() => CronJob[])} jobs every job the site's triggers run, or a function giving them (called per call)
 * @param {CronOptions} [options]
 * @returns {import("./operator.mjs").OperatorTool}
 */
export function runJobTool(db: D1Like | (() => D1Like) | null, jobs: CronJob[] | (() => CronJob[]), options?: CronOptions): import("./operator.mjs").OperatorTool;
/**
 * The operator tool `backup_status` (./operator): the backup state read now, uncached. `files` names the site's
 * file passes beside the D1 dump, so the description says what the answer covers.
 * @param {() => unknown} status the site's backup read (d1-dump's backupHealth over its bucket, as /health's `backup`)
 * @param {{ files?: string[] }} [options]
 * @returns {import("./operator.mjs").OperatorTool}
 */
export function backupStatusTool(status: () => unknown, { files }?: {
    files?: string[];
}): import("./operator.mjs").OperatorTool;
/**
 * The two operator tools every site's scheduled jobs answer through: `backup_status` (backupStatusTool) and `run_job`
 * (runJobTool), for a site's operatorResponse `tools`. `history` is the site's runJobs history, so a job run now is kept
 * in `cron_run_log` as its trigger keeps it.
 * @param {{ db: D1Like | (() => D1Like) | null, jobs: CronJob[] | (() => CronJob[]), backupStatus: () => unknown, files?: string[], history?: boolean | CronHistory }} options
 * @returns {{ backup_status: import("./operator.mjs").OperatorTool, run_job: import("./operator.mjs").OperatorTool }}
 */
export function operatorJobTools({ db, jobs, backupStatus, files, history }: {
    db: D1Like | (() => D1Like) | null;
    jobs: CronJob[] | (() => CronJob[]);
    backupStatus: () => unknown;
    files?: string[];
    history?: boolean | CronHistory;
}): {
    backup_status: import("./operator.mjs").OperatorTool;
    run_job: import("./operator.mjs").OperatorTool;
};
/**
 * One line for what a `run_job` call came to (./operator callOperator). `what` names the call ("run_job { backup: true }").
 * @param {string} what
 * @param {{ ok: boolean, status: number, data: unknown, error: string | null }} call
 * @returns {string}
 */
export function describeRuns(what: string, call: {
    ok: boolean;
    status: number;
    data: unknown;
    error: string | null;
}): string;
/**
 * Whether a `run_job` answer shows every run succeeded or skipped by its own gate: false for a failed call, an answer
 * without its runs, or any run that failed or was refused (a run that failed without throwing).
 * @param {{ ok: boolean, data: unknown }} call
 * @returns {boolean}
 */
export function runsSucceeded(call: {
    ok: boolean;
    data: unknown;
}): boolean;
/**
 * The every-minute job that makes Carrel's scheduled changes go live (site-api's schedules), named "carrel-schedules"
 * on every site. 50 seconds by default, so a hung run never runs into the next minute's.
 * @param {(signal: AbortSignal) => Promise<unknown>} run
 * @param {{ timeoutMs?: number }} [options]
 * @returns {CronJob}
 */
export function carrelSchedulesJob(run: (signal: AbortSignal) => Promise<unknown>, { timeoutMs }?: {
    timeoutMs?: number;
}): CronJob;
/**
 * The nightly D1 dump, named "backup" and marked `backup` (Capsid Admin's back up now runs it). Five minutes by
 * default, inside a scheduled invocation's 15 beside the files passes.
 * @param {(signal: AbortSignal) => Promise<unknown>} run
 * @param {{ name?: string, timeoutMs?: number }} [options] `name` for a files pass ("media-backup")
 * @returns {CronJob}
 */
export function backupJob(run: (signal: AbortSignal) => Promise<unknown>, { name, timeoutMs }?: {
    name?: string;
    timeoutMs?: number;
}): CronJob;
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
export const CRON_ERROR_MAX: 500;
/** How long a job may run before runJobs records it failed and starts the next: five minutes. */
export const CRON_TIMEOUT_MS: number;
/** The migration: a D1 site adds it as its next file under `migrations/`. Times are epoch milliseconds. */
export const CRON_SQL: "CREATE TABLE IF NOT EXISTS cron_runs (\n  name TEXT PRIMARY KEY NOT NULL,\n  every_minutes INTEGER NOT NULL,\n  first_started_at INTEGER,\n  last_started_at INTEGER,\n  last_ok_at INTEGER,\n  last_failed_at INTEGER,\n  last_error TEXT\n);\n";
/** The migration for the opt-in history (`runJobs(..., { history })`): one row per recorded run. Times are epoch milliseconds. */
export const CRON_LOG_SQL: "CREATE TABLE IF NOT EXISTS cron_run_log (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  name TEXT NOT NULL,\n  started_at INTEGER NOT NULL,\n  finished_at INTEGER NOT NULL,\n  outcome TEXT NOT NULL,\n  reason TEXT NOT NULL DEFAULT ''\n);\nCREATE INDEX IF NOT EXISTS cron_run_log_name ON cron_run_log (name, id);\n";
/** What a job's run resolves to when its own gate skipped it: no success is recorded. */
export const CRON_SKIPPED: unique symbol;
/** The longest result runJob hands back, as JSON: a job's summary, never its data. */
export const CRON_RESULT_MAX: 4000;
export const DAILY_MINUTES: 1440;
export type D1Like = {
    prepare(sql: string): {
        bind(...values: unknown[]): {
            run(): Promise<unknown>;
            all(): Promise<{
                results: unknown[];
            }>;
        };
    };
};
export type CronJob = {
    name: string;
    everyMinutes: number | null;
    timeoutMs?: number;
    holdOnTimeout?: boolean;
    backup?: boolean;
    run: (signal: AbortSignal, run: {
        startedAt: number;
    }) => Promise<unknown>;
};
export type CronOutcome = {
    job: string;
    status: "ok" | "skipped" | "failed" | "refused";
    ms: number;
    result?: unknown;
    reason?: string;
    error?: string;
    down?: boolean;
};
export type CronHistory = {
    keep?: number;
    retentionDays?: number;
};
export type CronOptions = {
    now?: () => number;
    timeoutMs?: number;
    history?: boolean | CronHistory;
};
/**
 * Why a job in `cron_runs` is not well, with its last success (epoch ms) or null.
 */
export type CronFinding = {
    name: string;
    reason: "failed" | "stale" | "never succeeded" | "never ran";
    lastOkAt: number | null;
};
/**
 * What cronFindings and cronCheck read: the grace, the site's own list of jobs, when it was deployed, the clock.
 */
export type CronFindingsOptions = {
    /**
     * Minutes past a job's interval, or a function of the interval in minutes.
     */
    graceMinutes?: number | ((everyMinutes: number) => number) | undefined;
    jobs?: {
        name: string;
        everyMinutes: number | null;
    }[] | undefined;
    deployedAt?: Date | undefined;
    now?: Date | undefined;
};
export type CronRun = {
    startedAt: number;
    finishedAt: number;
    outcome: "ok" | "refused" | "failed";
    reason: string;
};
export { CRON_EVENT_WINDOW_MS, cronCheck, cronFindings, cronStates, readCronRuns } from "./cron-status.mjs";
