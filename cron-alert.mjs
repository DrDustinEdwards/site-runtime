/**
 * Tell a person once a day about each job that is not well: cronFindings (./cron) says which, and an `alerts_sent` row
 * per key, kind and UTC day is both the record and the dedupe, claimed before the mail so two invocations racing cannot
 * both send. From Foxhound's cron alerts (app/lib/cron/alerts.server.ts).
 *
 * - cronAlert mails the findings as one message through the send_email binding, or hands them to the site's own `send`
 *   (its mail templates, its sender), all at once or `each` on its own.
 * - alertOnce is the claim, send and give-back for any other alert a site raises at most once a day: a failure the
 *   moment it happens, a dead-letter queue that filled.
 *
 * Fail-open: the alert never takes down the cron it watches. A failed mail gives its claims back so the next run
 * tries again; a claim that fails for any reason but "already claimed" sends anyway, since the alert exists to
 * report a broken system.
 */

import { cronFindings } from "./cron.mjs";
import { sendEmail } from "./email.mjs";
import { logEvent } from "./log.mjs";
import { dayKey } from "./time.mjs";

/** The migration: a D1 site adds it as its next file. `key` is what the alert is about (a job's name, a queue), `day`
 *  the UTC date, YYYY-MM-DD. */
export const ALERTS_SQL = `CREATE TABLE IF NOT EXISTS alerts_sent (
  key TEXT NOT NULL,
  kind TEXT NOT NULL,
  day TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (key, kind, day)
);
`;

const CLAIM = `INSERT INTO alerts_sent (key, kind, day, detail, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
ON CONFLICT (key, kind, day) DO NOTHING`;
const RELEASE = "DELETE FROM alerts_sent WHERE key = ?1 AND kind = ?2 AND day = ?3";
const PRUNE = "DELETE FROM alerts_sent WHERE day < ?1";

/** How many days of alerts are kept. */
const KEEP_DAYS = 30;

/**
 * An age in words, as Foxhound wrote it: "5 minutes ago", "3 hours ago".
 * @param {number} ms
 */
export function describeAge(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds} seconds ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}

/**
 * @typedef {{ name: string, kind: "failure" | "stale", reason: "failed" | "stale" | "never succeeded" | "never ran", lastOkAt: number | null, line: string }} CronAlertItem
 * @typedef {{ sent: true } | { sent: false, reason: "deduped" } | { sent: false, reason: "send_failed", error: string }} AlertOutcome
 */

/**
 * Raise one alert at most once per key, kind and UTC day: claim the day's slot, `send`, and give the slot back when the
 * send did not go, so the next try sends. `send` resolves true (or `{ sent: true }`) when it went. Never throws.
 * @param {{
 *   db: import("./cron.d.mts").D1Like,
 *   key: string,
 *   kind: string,
 *   detail?: string,
 *   now?: Date,
 *   send: () => Promise<boolean | { sent: boolean, error?: string }>,
 * }} options
 * @returns {Promise<AlertOutcome>}
 */
export async function alertOnce({ db, key, kind, detail, now, send }) {
  const at = now ?? new Date();
  const day = dayKey(at);
  if (!(await claim(db, key, kind, day, detail ?? null, at.getTime())))
    return { sent: false, reason: "deduped" };
  /** @type {string} */
  let error;
  try {
    const outcome = await send();
    if (outcome === true || (typeof outcome === "object" && outcome?.sent)) return { sent: true };
    error = (typeof outcome === "object" && outcome?.error) || "not sent";
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : "send failed";
  }
  await release(db, key, kind, day);
  return { sent: false, reason: "send_failed", error };
}

/**
 * Mail the jobs cronFindings names, each at most once per kind per UTC day. By default as one message through the
 * send_email binding (`mail`, `from`, `to`, `site`); with `send`, the site sends instead, given the new alerts all at once
 * or, with `each`, one alert per call. Never throws.
 * @param {{
 *   db: import("./cron.d.mts").D1Like,
 *   mail?: import("./email.d.mts").EmailBinding | null | undefined,
 *   from?: import("./email.d.mts").MailAddress,
 *   to?: import("./email.d.mts").MailAddress | import("./email.d.mts").MailAddress[],
 *   site?: string,
 *   send?: (alerts: CronAlertItem[]) => Promise<boolean | { sent: boolean, error?: string }>,
 *   each?: boolean,
 *   jobs?: Array<{ name: string, everyMinutes: number | null }>,
 *   deployedAt?: Date,
 *   graceMinutes?: number | ((everyMinutes: number) => number),
 *   now?: Date,
 * }} options `jobs`, `deployedAt` and `graceMinutes` are cronFindings' own
 * @returns {Promise<{ found: CronAlertItem[], alerted: string[], deduped: string[], mailed: boolean }>}
 */
export async function cronAlert({
  db,
  mail,
  from,
  to,
  site,
  send,
  each = false,
  jobs,
  deployedAt,
  graceMinutes,
  now,
}) {
  const at = now ?? new Date();
  const day = dayKey(at);
  const deliver =
    send ??
    (async (/** @type {CronAlertItem[]} */ alerts) =>
      (
        await sendEmail(mail, {
          from: /** @type {import("./email.d.mts").MailAddress} */ (from),
          to: /** @type {import("./email.d.mts").MailAddress} */ (to),
          subject: `${site}: ${alerts.length === 1 ? `cron ${alerts[0].kind} (${alerts[0].name})` : `${alerts.length} cron jobs not well`}`,
          text: `${alerts.map((a) => a.line).join("\n")}\n\nEach job is mailed once per day until it is well.`,
        })
      ).sent);
  /** @type {CronAlertItem[]} */
  let found;
  try {
    found = (await cronFindings(db, { jobs, deployedAt, graceMinutes, now: at })).map(
      ({ name, reason, lastOkAt }) => ({
        name,
        kind: reason === "failed" ? "failure" : "stale",
        reason,
        lastOkAt,
        line: `${name}: ${reason}, ${
          lastOkAt === null
            ? "no success on record"
            : `last succeeded ${describeAge(at.getTime() - lastOkAt)}`
        }`,
      }),
    );
  } catch (error) {
    logEvent("cron_alert_failed", { error }, { level: "error" });
    return { found: [], alerted: [], deduped: [], mailed: false };
  }
  try {
    await db
      .prepare(PRUNE)
      .bind(dayKey(new Date(at.getTime() - KEEP_DAYS * 86_400_000)))
      .run();
  } catch (error) {
    // Housekeeping only: the alerts still go.
    logEvent("cron_alert_prune_failed", { error }, { level: "warn" });
  }
  /** @type {string[]} */
  const deduped = [];
  /** @type {string[]} */
  const alerted = [];
  if (each) {
    for (const item of found) {
      const outcome = await alertOnce({
        db,
        key: item.name,
        kind: item.kind,
        detail: item.line,
        now: at,
        send: () => deliver([item]),
      });
      if (outcome.sent) alerted.push(item.name);
      else if (outcome.reason === "deduped") deduped.push(item.name);
      else
        logEvent(
          "cron_alert_send_failed",
          { item: item.name, error: outcome.error },
          { level: "error" },
        );
    }
    return { found, alerted, deduped, mailed: alerted.length > 0 };
  }
  /** @type {CronAlertItem[]} */
  const fresh = [];
  for (const item of found) {
    if (await claim(db, item.name, item.kind, day, item.line, at.getTime())) fresh.push(item);
    else deduped.push(item.name);
  }
  if (fresh.length === 0) return { found, alerted, deduped, mailed: false };
  let sent = false;
  try {
    const outcome = await deliver(fresh);
    sent = outcome === true || (typeof outcome === "object" && outcome?.sent === true);
    if (!sent)
      logEvent(
        "cron_alert_send_failed",
        {
          items: fresh.map((f) => f.name),
          error: (typeof outcome === "object" && outcome?.error) || "not sent",
        },
        { level: "error" },
      );
  } catch (error) {
    logEvent("cron_alert_send_failed", { error }, { level: "error" });
  }
  if (!sent) {
    for (const { name, kind } of fresh) await release(db, name, kind, day);
    return { found, alerted, deduped, mailed: false };
  }
  return { found, alerted: fresh.map((f) => f.name), deduped, mailed: true };
}

/**
 * Claim the one slot per key, kind and day: true means this caller may send it.
 * @param {import("./cron.d.mts").D1Like} db
 * @param {string} key
 * @param {string} kind
 * @param {string} day
 * @param {string | null} detail
 * @param {number} at
 */
async function claim(db, key, kind, day, detail, at) {
  try {
    const result = /** @type {{ meta?: { changes?: number } } | undefined} */ (
      await db.prepare(CLAIM).bind(key, kind, day, detail, at).run()
    );
    return result?.meta?.changes !== 0;
  } catch (error) {
    logEvent("alert_claim_failed", { key, error }, { level: "error" });
    return true;
  }
}

/**
 * Give a claimed slot back after a send that did not go.
 * @param {import("./cron.d.mts").D1Like} db
 * @param {string} key
 * @param {string} kind
 * @param {string} day
 */
async function release(db, key, kind, day) {
  await db
    .prepare(RELEASE)
    .bind(key, kind, day)
    .run()
    // A slot not given back keeps that alert from going out again today, so the failure is logged.
    .catch((error) => logEvent("alert_release_failed", { key, error }, { level: "warn" }));
}
