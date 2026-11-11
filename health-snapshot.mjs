/**
 * /health's verdict kept in KV for a page to show (dustinedwards.info's colophon tile), without running the checks in
 * a page loader. From dei (app/lib/health/snapshot*.mjs).
 *
 * One writer only: the site's scheduled job calls storeHealthSnapshot, so the snapshot's AGE is that job's liveness.
 * Nothing else may stamp the key, /health included (probes read it every few minutes and would keep a stopped job
 * looking alive). A reader never writes, and a failed read is `unreadable`, never `missing`.
 */

import { healthChecks } from "./health-read.mjs";
import { errorMessage, logEvent } from "./log.mjs";

/** One key, not a prefix: a prefix would invite a second writer. */
export const HEALTH_SNAPSHOT_KEY = "health:snapshot";

/** The job's usual interval in minutes; a snapshot is stale after three of them (a Cron Trigger is best effort). */
export const HEALTH_SNAPSHOT_EVERY_MINUTES = 15;

/**
 * The tile a page shows. Fails to "missing" in every uncertain direction, a future timestamp included: this is untyped
 * KV JSON, and a cached page presenting a bad value as a verdict would be lying.
 * @param {unknown} snapshot the parsed KV value, or null
 * @param {number} nowMs
 * @param {{ everyMinutes?: number }} [options]
 * @returns {import("./health-snapshot.d.mts").HealthTile}
 */
export function healthTile(snapshot, nowMs, { everyMinutes = HEALTH_SNAPSHOT_EVERY_MINUTES } = {}) {
  if (!snapshot || typeof snapshot !== "object") return { state: "missing" };
  const { ok, total, failed, readAt, checks } = /** @type {Record<string, unknown>} */ (snapshot);
  if (typeof readAt !== "string" || typeof ok !== "boolean") return { state: "missing" };
  if (!Array.isArray(checks) || checks.length !== total) return { state: "missing" };
  const named = checks.filter(
    (c) =>
      c &&
      typeof c.name === "string" &&
      (c.status === "pass" || c.status === "warn" || c.status === "fail"),
  );
  if (named.length !== checks.length) return { state: "missing" };
  if (!Number.isFinite(total) || !Number.isFinite(failed)) return { state: "missing" };
  const takenMs = Date.parse(readAt);
  if (!Number.isFinite(takenMs)) return { state: "missing" };
  const ageSeconds = Math.floor((nowMs - takenMs) / 1000);
  if (ageSeconds < 0) return { state: "missing" };
  return {
    state: ageSeconds > 3 * everyMinutes * 60 ? "stale" : "fresh",
    ok,
    total: /** @type {number} */ (total),
    failed: /** @type {number} */ (failed),
    readAt,
    ageSeconds,
    checks: named.map((c) => ({ name: c.name, status: c.status })),
  };
}

/**
 * An age in words, with no seconds: on a fifteen-minute schedule "47 seconds ago" claims a precision it lacks.
 * @param {number} ageSeconds
 */
export function formatAge(ageSeconds) {
  if (ageSeconds < 60) return "under a minute ago";
  const minutes = Math.floor(ageSeconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Each check's name and status, as public as /health itself, and no detail. Null for a body that is not a /health
 * answer, so a refusal or an error page is never stored as a verdict.
 * @param {unknown} body the parsed /health body
 * @param {string} readAt an ISO time
 * @returns {import("./health-snapshot.d.mts").HealthSnapshot | null}
 */
export function snapshotFromBody(body, readAt) {
  const checks = healthChecks(body);
  if (checks.length === 0) return null;
  return {
    ok: checks.every((c) => c.ok),
    total: checks.length,
    failed: checks.filter((c) => !c.ok).length,
    readAt,
    checks: checks.map((c) => ({ name: c.name, status: c.status })),
  };
}

/**
 * The one writer, for the site's scheduled job: run the site's /health answer and store its checks. Throws when nothing
 * was stored, so runJobs records the job failed and /health's cron check names it.
 * @param {{ kv: KVNamespace, answer: () => Promise<Response>, now?: Date, key?: string }} options
 */
export async function storeHealthSnapshot({
  kv,
  answer,
  now = new Date(),
  key = HEALTH_SNAPSHOT_KEY,
}) {
  const response = await answer();
  const body = await response.json().catch(() => null);
  const snapshot = snapshotFromBody(body, now.toISOString());
  if (!snapshot)
    throw new Error(
      `the health answer (HTTP ${response.status}) named no checks, so no snapshot was stored`,
    );
  await kv.put(key, JSON.stringify(snapshot));
}

/**
 * The tile for a page. A failed KV read is `unreadable` (and logged), not `missing`: the page renders whatever KV is
 * doing, but a failed read is not the same fact as no snapshot.
 * @param {{ kv: KVNamespace, now?: number, everyMinutes?: number, key?: string }} options
 * @returns {Promise<import("./health-snapshot.d.mts").HealthTile>}
 */
export async function readHealthTile({
  kv,
  now = Date.now(),
  everyMinutes,
  key = HEALTH_SNAPSHOT_KEY,
}) {
  /** @type {unknown} */
  let stored;
  try {
    stored = await kv.get(key, "json");
  } catch (error) {
    logEvent("health_snapshot_read_failed", { detail: errorMessage(error) }, { level: "error" });
    return { state: "unreadable" };
  }
  return healthTile(stored, now, { everyMinutes });
}
