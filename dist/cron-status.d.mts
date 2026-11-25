/**
 * Each job in `cron_runs` that is not well, as data: the reason is "failed" (its last run failed), "stale" (its last
 * success is older than its interval plus the grace), "never succeeded" (first started longer ago than that, no
 * success) or "never ran" (given `jobs`, no row once its window has passed since `deployedAt`, at once without it).
 * `lastOkAt` is the last success in epoch ms, or null. The grace is `graceMinutes` when given (minutes, or a function
 * of the interval: `(every) => every` allows a whole missed period), else the larger of 10 minutes and a tenth of it.
 * @param {D1Like | (() => D1Like)} db
 * @param {{ graceMinutes?: number | ((everyMinutes: number) => number), jobs?: Array<{ name: string, everyMinutes: number | null }>, deployedAt?: Date, now?: Date }} [options]
 * @returns {Promise<Array<{ name: string, reason: "failed" | "stale" | "never succeeded" | "never ran", lastOkAt: number | null }>>}
 */
export function cronFindings(db: D1Like | (() => D1Like), { graceMinutes, jobs, deployedAt, now }?: {
    graceMinutes?: number | ((everyMinutes: number) => number);
    jobs?: Array<{
        name: string;
        everyMinutes: number | null;
    }>;
    deployedAt?: Date;
    now?: Date;
}): Promise<Array<{
    name: string;
    reason: "failed" | "stale" | "never succeeded" | "never ran";
    lastOkAt: number | null;
}>>;
/**
 * The /health check for the jobs in `cron_runs` (name "cron", level warn): cronFindings, named in its detail.
 * Given `jobs` (the list the site passes runJobs), it reads only those, so a removed job's old row is ignored.
 * @param {D1Like | (() => D1Like)} db
 * @param {{ graceMinutes?: number | ((everyMinutes: number) => number), jobs?: Array<{ name: string, everyMinutes: number | null }>, deployedAt?: Date, now?: Date }} [options]
 * @returns {{ name: "cron", level: "warn", run: () => Promise<true | { ok: false, detail: string }> }}
 */
export function cronCheck(db: D1Like | (() => D1Like), options?: {
    graceMinutes?: number | ((everyMinutes: number) => number);
    jobs?: Array<{
        name: string;
        everyMinutes: number | null;
    }>;
    deployedAt?: Date;
    now?: Date;
}): {
    name: "cron";
    level: "warn";
    run: () => Promise<true | {
        ok: false;
        detail: string;
    }>;
};
/**
 * @typedef {{ startedAt: number, finishedAt: number, outcome: "ok" | "refused" | "failed", reason: string }} CronRun
 */
/**
 * The newest runs of each job from `cron_run_log` (runJobs' `history`), newest first, in one read. Every name asked
 * for is in the map, empty when it has no run. Without `names`, every job with a run.
 * @param {D1Like | (() => D1Like)} db
 * @param {string[]} [names]
 * @param {number} [per] runs per job (default 5)
 * @returns {Promise<Map<string, CronRun[]>>}
 */
export function readCronRuns(db: D1Like | (() => D1Like), names?: string[], per?: number): Promise<Map<string, CronRun[]>>;
/**
 * Each job with its newest runs and its flag at `now`, for a page that lists them (Capsid's Portal):
 * - `failing`: the newest run failed or was refused; for an event job only inside CRON_EVENT_WINDOW_MS.
 * - `quiet`: a periodic job whose newest run finished more than `quietPeriods` (default 2) of its periods ago.
 * - `never`: no run on record, a notice and not a fault.
 * @param {Array<{ name: string, everyMinutes: number | null }>} jobs
 * @param {Map<string, CronRun[]>} runs readCronRuns' answer
 * @param {Date} now
 * @param {{ quietPeriods?: number }} [options]
 * @returns {Array<{ name: string, everyMinutes: number | null, flag: "failing" | "quiet" | "never" | null, recent: CronRun[] }>}
 */
export function cronStates(jobs: Array<{
    name: string;
    everyMinutes: number | null;
}>, runs: Map<string, CronRun[]>, now: Date, { quietPeriods }?: {
    quietPeriods?: number;
}): Array<{
    name: string;
    everyMinutes: number | null;
    flag: "failing" | "quiet" | "never" | null;
    recent: CronRun[];
}>;
/**
 * What the cron history says about the jobs: the findings, the /health check and each job's flag (see cron.mjs for the
 * runner and the record). ./cron re-exports what a caller imports.
 */
/** @typedef {import("./cron.mjs").D1Like} D1Like */
/** How long a failure of an event job (`everyMinutes: null`) counts as current: a day. */
export const CRON_EVENT_WINDOW_MS: number;
export type CronRun = {
    startedAt: number;
    finishedAt: number;
    outcome: "ok" | "refused" | "failed";
    reason: string;
};
export type D1Like = import("./cron.mjs").D1Like;
