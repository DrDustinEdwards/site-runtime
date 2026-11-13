/** A site's scheduled jobs, each isolated, recorded in D1 `cron_runs`, and the /health check that notices one stopped (cron.mjs). */

/** The longest error stored: 500. */
export const CRON_ERROR_MAX: number;
/** How long a job may run before it is recorded failed and the next starts: 300000 (five minutes). */
export const CRON_TIMEOUT_MS: number;
/** The migration for the opt-in history: `cron_run_log` (name, started_at, finished_at, outcome, reason; epoch ms), indexed by name. */
export const CRON_LOG_SQL: string;
/** How long the failure of an event job (`everyMinutes: null`) counts as current: 86400000 (a day). */
export const CRON_EVENT_WINDOW_MS: number;
/** The migration: `cron_runs` (name, every_minutes, first_started_at, last_started_at, last_ok_at, last_failed_at, last_error; epoch ms). */
export const CRON_SQL: string;

/** What a job's run resolves to when its own gate skipped it: logged `cron_job_skipped`, no success recorded. */
export const CRON_SKIPPED: unique symbol;

/** The part of a D1 binding this uses. */
export interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): { run(): Promise<unknown>; all(): Promise<{ results: unknown[] }> };
  };
}

/**
 * One job: `everyMinutes` is how often its trigger fires, or null for an event job (runs come and go with the work: no
 * stale window, flagged only by a failure inside the last day); `timeoutMs` overrides runJobs' timeout for it. `run` gets a
 * signal aborted when the job times out, and `startedAt` (epoch ms), with the name the key of its `cron_run_log` row.
 */
export interface CronJob {
  name: string;
  everyMinutes: number | null;
  timeoutMs?: number;
  /**
   * For a job holding a lock or moving money: past its timeout it is recorded failed and its signal aborted, but the
   * runner waits for it to end before the next job starts, and its late end records no success.
   */
  holdOnTimeout?: boolean;
  /** A backup job: one Capsid Admin's back up now runs (runJobTool's `{ backup: true }`). */
  backup?: boolean;
  run: (signal: AbortSignal, run: { startedAt: number }) => Promise<unknown>;
}

/** What one run came to: its own result (as JSON, cut to CRON_RESULT_MAX) on a success, the stored error on a failure. */
export interface CronOutcome {
  job: string;
  status: "ok" | "skipped" | "failed" | "refused";
  ms: number;
  result?: unknown;
  /** The one-line reason a job gave (`history` on): what an ok run did, why a run was refused. */
  reason?: string;
  error?: string;
}

/** Keep each run in `cron_run_log`: `keep` newest per job (default 5) and none older than `retentionDays` (default 14). */
export interface CronHistory {
  keep?: number;
  retentionDays?: number;
}

/** Options shared by runJobs, runJobNow and runJobTool. */
export interface CronOptions {
  now?: () => number;
  timeoutMs?: number;
  /**
   * Opt in to the run history. A job may then resolve `{ outcome: "ok" | "refused" | "skipped", reason }`: ok records the
   * reason, refused records the run failed (cron_runs and /health too) without throwing, skipped records nothing, as
   * CRON_SKIPPED does. Without it, runs are recorded as before.
   */
  history?: boolean | CronHistory;
}

/** One recorded run: epoch ms, its outcome and its one-line reason. */
export interface CronRun {
  startedAt: number;
  finishedAt: number;
  outcome: "ok" | "refused" | "failed";
  reason: string;
}

/** The longest result a run hands back, as JSON: 4000. */
export const CRON_RESULT_MAX: number;

/**
 * Runs `jobs` in turn, each isolated and raced against its timeout (the job's `timeoutMs`, else `options.timeoutMs`,
 * default CRON_TIMEOUT_MS; a timed-out job is recorded failed and the next runs, after it ends when it holds on
 * timeout; a run resolving to CRON_SKIPPED records no success), logging cron_job_ok or
 * cron_job_failed and recording each in `cron_runs`; a failed record write is logged and the job still runs. Throws one
 * Error naming the failed jobs after the last one.
 */
export function runJobs(
  db: D1Like | (() => D1Like) | null,
  jobs: CronJob[],
  options?: CronOptions & { rethrow?: boolean },
): Promise<CronOutcome[]>;

/**
 * RUN NOW: one job by name through the same path as runJobs (its cron_runs record, its timeout). Answers the outcome,
 * a failure included; throws only on an unknown name. Null `db` records nothing.
 */
export function runJobNow(
  db: D1Like | (() => D1Like) | null,
  jobs: CronJob[],
  name: string,
  options?: CronOptions,
): Promise<CronOutcome>;

/**
 * The operator tool `run_job` (./operator): `{ job: "<name>" }` runs that job now, `{ backup: true }` every job marked
 * backup, each through runJobNow. Answers `{ runs: CronOutcome[] }`.
 */
export function runJobTool(
  db: D1Like | (() => D1Like) | null,
  jobs: CronJob[] | (() => CronJob[]),
  options?: CronOptions,
): import("./operator.d.mts").OperatorTool;

/** The operator tool `backup_status`: the backup read now, uncached; `files` names the files passes beside the dump. */
export function backupStatusTool(
  status: () => unknown,
  options?: { files?: string[] },
): import("./operator.d.mts").OperatorTool;
/** One line for what a run_job call came to (callOperator's result): each run, or why nothing was proven. */
export function describeRuns(
  what: string,
  call: { ok: boolean; status: number; data: unknown; error: string | null },
): string;
/** Whether every run in a run_job answer succeeded or was skipped; false for a failed call, one without its runs, or a failed or refused run. */
export function runsSucceeded(call: { ok: boolean; data: unknown }): boolean;
/** `backup_status` and `run_job` together, for a site's operatorResponse tools; `history` as the site's runJobs has it. */
export function operatorJobTools(options: {
  db: D1Like | (() => D1Like) | null;
  jobs: CronJob[] | (() => CronJob[]);
  backupStatus: () => unknown;
  files?: string[];
  history?: boolean | CronHistory;
}): {
  backup_status: import("./operator.d.mts").OperatorTool;
  run_job: import("./operator.d.mts").OperatorTool;
};
/** 1440: a nightly job's interval in minutes. */
export const DAILY_MINUTES: number;
/** "carrel-schedules", every minute, 50 s by default. */
export function carrelSchedulesJob(
  run: (signal: AbortSignal) => Promise<unknown>,
  options?: { timeoutMs?: number },
): CronJob;
/** The nightly dump "backup" (or a files pass by `name`), marked backup, 5 minutes by default. */
export function backupJob(
  run: (signal: AbortSignal) => Promise<unknown>,
  options?: { name?: string; timeoutMs?: number },
): CronJob;

/** Why a job in `cron_runs` is not well, with its last success (epoch ms) or null. */
export interface CronFinding {
  name: string;
  reason: "failed" | "stale" | "never succeeded" | "never ran";
  lastOkAt: number | null;
}

/** What cronFindings and cronCheck read: the grace, the site's own list of jobs, when it was deployed, the clock. */
export interface CronFindingsOptions {
  /** Minutes past a job's interval, or a function of the interval in minutes. */
  graceMinutes?: number | ((everyMinutes: number) => number);
  jobs?: Array<{ name: string; everyMinutes: number | null }>;
  deployedAt?: Date;
  now?: Date;
}

/** The jobs cronCheck would name, as data, for a site that mails its own alert. Same options as cronCheck. */
export function cronFindings(
  db: D1Like | (() => D1Like),
  options?: CronFindingsOptions,
): Promise<CronFinding[]>;

/**
 * The newest runs of each job from `cron_run_log` (runJobs' `history`), newest first, in one read. Every name asked for
 * is in the map (empty without a run); without `names`, every job with a run.
 */
export function readCronRuns(
  db: D1Like | (() => D1Like),
  names?: string[],
  per?: number,
): Promise<Map<string, CronRun[]>>;

/**
 * Each job with its newest runs and its flag at `now`: `failing` (the newest run failed or was refused; an event job only
 * inside CRON_EVENT_WINDOW_MS), `quiet` (a periodic job whose newest run finished over `quietPeriods`, default 2, periods
 * ago), `never` (no run on record, a notice and not a fault).
 */
export function cronStates(
  jobs: Array<{ name: string; everyMinutes: number | null }>,
  runs: Map<string, CronRun[]>,
  now: Date,
  options?: { quietPeriods?: number },
): Array<{
  name: string;
  everyMinutes: number | null;
  flag: "failing" | "quiet" | "never" | null;
  recent: CronRun[];
}>;

/**
 * The /health check (name "cron", level warn): fails, naming the jobs, when a job's last run failed, its last success is
 * older than its interval + the grace (`graceMinutes`, default the larger of 10 and a tenth of the interval), or it never
 * succeeded and was first started longer ago. Given `jobs`, only those are read, and one with no row fails "never ran"
 * once its window has passed since `deployedAt` (at once without it).
 */
export function cronCheck(
  db: D1Like | (() => D1Like),
  options?: CronFindingsOptions,
): { name: "cron"; level: "warn"; run: () => Promise<true | { ok: false; detail: string }> };
