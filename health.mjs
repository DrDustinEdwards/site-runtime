/**
 * The /health response for uptime monitors and the Capsid console, in the shape of the IETF health check draft
 * (draft-inadarei-api-health-check-06): `application/health+json` with `status` "pass", "warn" or "fail". Unauthenticated,
 * so the body carries only each check's name, status and a short scrubbed detail, the backup's status, the deployed
 * commit when given and the time. Never cached, never indexed.
 *
 * Every check has a level. A failed "fail" check (the database `ping`, by default any site check) makes the status
 * fail and the response 503; a failed "warn" check (a stale backup, a cron that stopped, content drift) makes it warn
 * and leaves it 200, because the site is up. `ok` is `status !== "fail"`: true while the site is up, so a keyword
 * monitor reading `ok` pages only for an outage, and a warning shows in `status` and the checks.
 *
 * A check may also be an alert (`alert: true`): its failure says someone should look now, though the site is up, so
 * its level stays warn (the response stays 200 and `ok` true, so devkit's worker-deploy never rolls a deploy back for
 * it) and its result carries `alert: true`, which a watcher keys on to raise a finding and mail a person. `alerts`
 * names the failing ones. The sign-in spike check is one.
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
 * @typedef {{ name: string, level?: "fail" | "warn", alert?: boolean, run: () => Promise<unknown> }} HealthCheck
 * @typedef {{ name: string, status: "pass" | "warn" | "fail", detail?: string, alert?: true }} CheckResult
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
  const alerts = results.filter((r) => r.alert).map((r) => r.name);
  const body = {
    status,
    ok: status !== "fail",
    ...(alerts.length ? { alerts } : {}),
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
async function runCheck({ name, level = "fail", alert = false, run }, timeoutMs) {
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
  if (level === "fail" || alert) logEvent(alert ? "health_alert" : "health_check_failed", { check: name, detail: cut }, { level: "error" });
  return { name, status: level, ...(cut ? { detail: cut } : {}), ...(alert ? { alert: /** @type {const} */ (true) } : {}) };
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
 * The spike alert for sign-in (F3): a check that fails when, in the last `windowMinutes`, failed sign-ins or sign-in
 * mails passed their ceiling, read from `./sign-in`'s `auth_events` table (`eventsDb`). Level warn, so the site stays
 * up and a deploy is never rolled back for it, and an alert (`alert: true` on its result, and in `alerts`), so the
 * watcher mails a person. The detail gives the counts, never an address.
 * @param {import("./sign-in-account.mjs").D1Like} db
 * @param {{ windowMinutes?: number, failures?: number, mails?: number, now?: () => number }} [limits]
 * @returns {HealthCheck}
 */
export function authSpikeCheck(db, { windowMinutes = 60, failures = 50, mails = 50, now = Date.now } = {}) {
  return {
    name: "auth-spike",
    level: "warn",
    alert: true,
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

// The smallest GIF (1 x 1, transparent): what imagesCheck asks the Images binding to read.
const PROBE_GIF = /* @__PURE__ */ Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));

/**
 * A check that the Images binding answers: `info` on a 1 x 1 GIF, which reads the image's header and transforms
 * nothing. Level warn, so a broken resize path shows without taking the site to 503.
 * @param {string} name
 * @param {{ info(stream: ReadableStream<Uint8Array>): Promise<unknown> }} images
 * @returns {HealthCheck}
 */
export function imagesCheck(name, images) {
  return { name, level: "warn", run: async () => (await images.info(new Blob([PROBE_GIF]).stream()), true) };
}

/**
 * A check that a Durable Object namespace is bound and can mint an id (`idFromName`, no request to an object, which
 * would wake one and bill it). Level warn.
 * @param {string} name
 * @param {{ idFromName(name: string): unknown } | undefined} namespace
 * @returns {HealthCheck}
 */
export function durableObjectCheck(name, namespace) {
  return {
    name,
    level: "warn",
    run: async () => (typeof namespace?.idFromName === "function" ? (namespace.idFromName(PROBE_KEY), true) : { ok: false, detail: "binding missing" }),
  };
}

/**
 * A check that a Queue producer binding is present. It sends nothing: a probe message would reach the consumer. Level warn.
 * @param {string} name
 * @param {{ send(message: unknown): Promise<unknown> } | undefined} queue
 * @returns {HealthCheck}
 */
export function queueCheck(name, queue) {
  return bindingCheck(name, typeof queue?.send === "function");
}

/**
 * A check that the Workers AI binding is present. It runs no model: every call is billed. Level warn.
 * @param {string} name
 * @param {{ run(...args: any[]): Promise<unknown> } | undefined} ai
 * @returns {HealthCheck}
 */
export function aiCheck(name, ai) {
  return bindingCheck(name, typeof ai?.run === "function");
}

/** @param {string} name @param {boolean} present @returns {HealthCheck} */
function bindingCheck(name, present) {
  return { name, level: "warn", run: async () => (present ? true : { ok: false, detail: "binding missing" }) };
}

/**
 * D1's messages for a database that is down or reset for a moment, as Cloudflare's D1 docs list them ("Error list",
 * "Retry a query"), with the Workers runtime's lost connection. A wrong query (no such table, a constraint) is not one.
 */
const DATABASE_DOWN =
  /D1 DB is overloaded|D1 DB's isolate exceeded its memory limit|D1 DB exceeded its CPU time limit|D1 DB storage operation exceeded timeout|Internal error (?:while starting up|in) D1 DB storage|Cannot resolve D1 DB due to transient issue|D1 DB reset because its code was updated|Network connection lost|D1_ERROR:.*(?:reset|overloaded|unavailable|timed? ?out)/i;

/**
 * Whether an error is the database being down or reset for a moment, read from the error and its causes.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isDatabaseDown(error) {
  for (let e = error, depth = 0; e && depth < 5; e = /** @type {any} */ (e).cause, depth++) {
    const message = e instanceof Error ? e.message : typeof e === "string" ? e : "";
    if (DATABASE_DOWN.test(message)) return true;
  }
  return false;
}

/** The statusText Capsomer's ErrorPage reads to say the database is down. */
export const DATABASE_DOWN_STATUS_TEXT = "Database unavailable";

/**
 * Turns a database-down error into the 503 a React Router loader throws, so the error page says the site's data is
 * briefly unavailable instead of "Something went wrong", and the reader is told to try again (Retry-After 60). A thrown
 * Response reaches the client's error boundary intact, where a thrown Error is replaced by a generic one in production.
 * Any other error is returned unchanged: `catch (error) { throw databaseDown(error); }`.
 * @param {unknown} error
 * @returns {unknown}
 */
export function databaseDown(error) {
  if (!isDatabaseDown(error)) return error;
  logEvent("database_down", { error }, { level: "error" });
  return new Response(null, { status: 503, statusText: DATABASE_DOWN_STATUS_TEXT, headers: { "Retry-After": "60", "Cache-Control": "no-store" } });
}
