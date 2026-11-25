/**
 * What the cron history says about the jobs: the findings, the /health check and each job's flag (see cron.mjs for the
 * runner and the record). ./cron re-exports what a caller imports.
 */

/** @typedef {import("./cron.mjs").D1Like} D1Like */

/** How long a failure of an event job (`everyMinutes: null`) counts as current: a day. */
export const CRON_EVENT_WINDOW_MS = 24 * 60 * 60_000;

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
export async function cronFindings(db, { graceMinutes, jobs, deployedAt, now } = {}) {
  /** @param {number} every */
  const windowMs = (every) =>
    (every +
      (typeof graceMinutes === "function"
        ? graceMinutes(every)
        : (graceMinutes ?? Math.max(10, every / 10)))) *
    60_000;
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
      everyMinutes: Number(row.every_minutes) || null,
    }));
  /** @type {Array<{ name: string, reason: "failed" | "stale" | "never succeeded" | "never ran", lastOkAt: number | null }>} */
  const found = [];
  for (const { name, everyMinutes } of expected) {
    const row = rows.get(name);
    if (everyMinutes === null) {
      // An event job: no window to go stale in, only a failure inside the last day.
      const failedAt = row?.last_failed_at ?? null;
      const ok = row?.last_ok_at ?? null;
      if (
        failedAt !== null &&
        (ok === null || failedAt > ok) &&
        at - Number(failedAt) <= CRON_EVENT_WINDOW_MS
      )
        found.push({ name, reason: "failed", lastOkAt: ok === null ? null : Number(ok) });
      continue;
    }
    const limit = windowMs(everyMinutes);
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
 * The /health check for the jobs in `cron_runs` (name "cron", level warn): cronFindings, named in its detail.
 * Given `jobs` (the list the site passes runJobs), it reads only those, so a removed job's old row is ignored.
 * @param {D1Like | (() => D1Like)} db
 * @param {{ graceMinutes?: number | ((everyMinutes: number) => number), jobs?: Array<{ name: string, everyMinutes: number | null }>, deployedAt?: Date, now?: Date }} [options]
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
export async function readCronRuns(db, names, per = 5) {
  const { results } = await (typeof db === "function" ? db() : db)
    .prepare(
      `SELECT name, started_at, finished_at, outcome, reason FROM (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY name ORDER BY id DESC) AS rank FROM cron_run_log
       ) WHERE rank <= ?1 ORDER BY name, rank`,
    )
    .bind(per)
    .all();
  /** @type {Map<string, CronRun[]>} */
  const runs = new Map((names ?? []).map((name) => [name, []]));
  for (const row of /** @type {Array<Record<string, number | string>>} */ (results)) {
    const name = String(row.name);
    if (names && !runs.has(name)) continue;
    const list = runs.get(name) ?? [];
    list.push({
      startedAt: Number(row.started_at),
      finishedAt: Number(row.finished_at),
      outcome: /** @type {CronRun["outcome"]} */ (row.outcome),
      reason: String(row.reason),
    });
    runs.set(name, list);
  }
  return runs;
}

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
export function cronStates(jobs, runs, now, { quietPeriods = 2 } = {}) {
  return jobs.map(({ name, everyMinutes }) => {
    const recent = runs.get(name) ?? [];
    const last = recent[0];
    /** @type {"failing" | "quiet" | "never" | null} */
    let flag = null;
    if (!last) flag = "never";
    else if (last.outcome !== "ok") {
      if (everyMinutes !== null || now.getTime() - last.finishedAt <= CRON_EVENT_WINDOW_MS)
        flag = "failing";
    } else if (
      everyMinutes !== null &&
      now.getTime() - last.finishedAt > quietPeriods * everyMinutes * 60_000
    )
      flag = "quiet";
    return { name, everyMinutes, flag, recent };
  });
}
