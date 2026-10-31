/**
 * The /health response for uptime monitors and the Capsid console, in the shape of the IETF health check draft
 * (draft-inadarei-api-health-check-06): `application/health+json` with `status` "pass", "warn" or "fail". Unauthenticated,
 * so the body carries only each check's name, status and a short scrubbed detail, the backup's status, the deployed
 * commit when given and the time. Never cached, never indexed.
 *
 * Every check has a level. A failed "fail" check (the database `ping`, by default any site check) makes the status
 * fail and the response 503; a failed "warn" check (a stale backup, a cron that stopped, content drift) makes it warn
 * and leaves it 200, because the site is up. `ok` is `status === "pass"`, its meaning before the checks: up and no
 * backup warning, so a monitor reading `ok` sees a stale dump.
 *
 * Each check is raced against `checkTimeoutMs`, so a binding that hangs fails its check instead of holding /health.
 *
 * The backup read is held per isolate for `backupTtlMs` (five minutes by default). Reading it lists an R2 bucket, which
 * R2 bills as a Class A operation, and this route is public and uncached; the dump runs once a day, so an answer five
 * minutes old loses nothing.
 */

import { logEvent, scrubText } from "./log.mjs";
import { authEventCounts } from "./sign-in-account.mjs";

/** The longest `detail` a check reports. */
export const CHECK_DETAIL_MAX = 200;

// The key r2Check and kvCheck read: what comes back does not matter, only that the binding answers.
const PROBE_KEY = "health-check";

/** @type {{ at: number, value: unknown } | null} */
let held = null;

/**
 * @typedef {{ name: string, level?: "fail" | "warn", run: () => Promise<unknown> }} HealthCheck
 * @typedef {{ name: string, status: "pass" | "warn" | "fail", detail?: string }} CheckResult
 */

/**
 * @param {{ ping?: () => Promise<unknown>, backup?: () => Promise<unknown>, sha?: string, checks?: HealthCheck[], backupTtlMs?: number, checkTimeoutMs?: number, now?: Date }} probe
 * @returns {Promise<Response>}
 */
export async function healthResponse({ ping, backup, sha, checks = [], backupTtlMs = 5 * 60_000, checkTimeoutMs = 3000, now = new Date() } = {}) {
  const at = now.getTime();
  /** @type {unknown} */
  let backupStatus;
  /** @type {HealthCheck[]} */
  const all = [];
  if (ping) all.push({ name: "db", level: "fail", run: ping });
  if (backup) {
    all.push({
      name: "backup",
      level: "warn",
      run: async () => {
        if (!held || at - held.at >= backupTtlMs || at < held.at) held = { at, value: await backup() };
        backupStatus = held.value;
        const warning = backupStatus && typeof backupStatus === "object" && "warning" in backupStatus && backupStatus.warning;
        return warning ? { ok: false, detail: String(warning) } : true;
      },
    });
  }
  all.push(...checks);
  const results = await Promise.all(all.map((check) => runCheck(check, checkTimeoutMs)));
  const status = results.some((r) => r.status === "fail") ? "fail" : results.some((r) => r.status === "warn") ? "warn" : "pass";
  const db = ping ? { db: results[0]?.status === "pass" ? "up" : "down" } : {};
  const body = {
    status,
    ok: status === "pass",
    ...db,
    ...(backupStatus === undefined ? {} : { backup: backupStatus }),
    ...(sha ? { sha } : {}),
    time: now.toISOString(),
    checks: results,
  };
  return new Response(JSON.stringify(body), {
    status: status === "fail" ? 503 : 200,
    headers: { "Content-Type": "application/health+json; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}

/**
 * Runs one check against the timeout. It fails when `run` throws, rejects, times out, resolves `false` or resolves
 * `{ ok: false, detail? }`; a failed "fail" check is logged as `health_check_failed`.
 * @param {HealthCheck} check
 * @param {number} timeoutMs
 * @returns {Promise<CheckResult>}
 */
async function runCheck({ name, level = "fail", run }, timeoutMs) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  /** @type {string | undefined} */
  let detail;
  let failed = false;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
    });
    const value = await Promise.race([Promise.resolve().then(run), timeout]);
    if (value === false) failed = true;
    else if (value && typeof value === "object" && "ok" in value && value.ok === false) {
      failed = true;
      if ("detail" in value && typeof value.detail === "string") detail = value.detail;
    }
  } catch (error) {
    failed = true;
    detail = error instanceof Error ? error.message : String(error);
  } finally {
    clearTimeout(timer);
  }
  if (!failed) return { name, status: "pass" };
  const cut = detail === undefined ? undefined : scrubText(detail).slice(0, CHECK_DETAIL_MAX);
  if (level === "fail") logEvent("health_check_failed", { check: name, detail: cut }, { level: "error" });
  return { name, status: level, ...(cut ? { detail: cut } : {}) };
}

/**
 * A check that an R2 bucket answers: a `head` of a fixed key, where null (no such object) passes and a throw fails.
 * @param {string} name
 * @param {{ head(key: string): Promise<unknown> }} bucket
 * @returns {HealthCheck}
 */
export function r2Check(name, bucket) {
  return { name, run: async () => (await bucket.head(PROBE_KEY), true) };
}

/**
 * A check that a KV namespace answers: a `get` of a fixed key, where null passes and a throw fails.
 * @param {string} name
 * @param {{ get(key: string): Promise<unknown> }} kv
 * @returns {HealthCheck}
 */
export function kvCheck(name, kv) {
  return { name, run: async () => (await kv.get(PROBE_KEY), true) };
}

/**
 * The spike alert for sign-in (F3): a warn check that fails when, in the last `windowMinutes`, failed sign-ins or
 * sign-in mails passed their ceiling, read from `./sign-in`'s `auth_events` table (`eventsDb`). Level warn, so
 * /health and the daily live check show it and the site stays up. The detail gives the counts, never an address.
 * @param {import("./sign-in-account.mjs").D1Like} db
 * @param {{ windowMinutes?: number, failures?: number, mails?: number, now?: () => number }} [limits]
 * @returns {HealthCheck}
 */
export function authSpikeCheck(db, { windowMinutes = 60, failures = 50, mails = 50, now = Date.now } = {}) {
  return {
    name: "auth-spike",
    level: "warn",
    run: async () => {
      const counts = await authEventCounts(db, now() - windowMinutes * 60_000);
      const over = [
        counts.failures > failures ? `${counts.failures} failed sign-ins` : "",
        counts.mails > mails ? `${counts.mails} sign-in mails` : "",
      ].filter(Boolean);
      return over.length ? { ok: false, detail: `${over.join(" and ")} in ${windowMinutes} minutes` } : true;
    },
  };
}
