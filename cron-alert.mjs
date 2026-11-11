/**
 * Tell a person once a day about each job that is not well: cronFindings (./cron) says which, and a `cron_alerts` row per
 * job, kind and UTC day is both the record and the dedupe, claimed before the mail so two invocations racing cannot
 * both send. From Foxhound's cron alerts (app/lib/cron/alerts.server.ts); what stays Foxhound's is its enable switch,
 * its admin page and its dead-letter alert.
 *
 * Fail-open: the alert never takes down the cron it watches. A failed mail gives its claims back so the next run
 * tries again; a claim that fails for any reason but "already claimed" sends anyway, since the alert exists to
 * report a broken system.
 */

import { cronFindings } from "./cron.mjs";
import { sendEmail } from "./email.mjs";
import { logEvent } from "./log.mjs";

/** The migration: a D1 site adds it as its next file. `day` is the UTC date, YYYY-MM-DD. */
export const CRON_ALERTS_SQL = `CREATE TABLE IF NOT EXISTS cron_alerts (
  job TEXT NOT NULL,
  kind TEXT NOT NULL,
  day TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (job, kind, day)
);
`;

const CLAIM = `INSERT INTO cron_alerts (job, kind, day, detail, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
ON CONFLICT (job, kind, day) DO NOTHING`;
const RELEASE = "DELETE FROM cron_alerts WHERE job = ?1 AND kind = ?2 AND day = ?3";
const PRUNE = "DELETE FROM cron_alerts WHERE day < ?1";

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
 * Mail the jobs cronFindings names, each at most once per kind per UTC day, as one message. Never throws.
 * @param {{
 *   db: import("./cron.d.mts").D1Like,
 *   mail: import("./email.d.mts").EmailBinding | null | undefined,
 *   from: import("./email.d.mts").MailAddress,
 *   to: import("./email.d.mts").MailAddress | import("./email.d.mts").MailAddress[],
 *   site: string,
 *   jobs?: Array<{ name: string, everyMinutes: number | null }>,
 *   deployedAt?: Date,
 *   graceMinutes?: number,
 *   now?: Date,
 * }} options `mail` is the send_email binding; `site` names the site in the subject; `jobs`, `deployedAt` and
 *   `graceMinutes` are cronFindings' own
 * @returns {Promise<{ alerted: string[], deduped: string[], mailed: boolean }>}
 */
export async function cronAlert({ db, mail, from, to, site, jobs, deployedAt, graceMinutes, now }) {
  const at = now ?? new Date();
  const day = at.toISOString().slice(0, 10);
  /** @type {string[]} */
  const deduped = [];
  /** @type {Array<{ name: string, kind: string, line: string }>} */
  const fresh = [];
  try {
    const found = await cronFindings(db, { jobs, deployedAt, graceMinutes, now: at });
    for (const { name, reason, lastOkAt } of found) {
      const kind = reason === "failed" ? "failure" : "stale";
      const line = `${name}: ${reason}, ${
        lastOkAt === null
          ? "no success on record"
          : `last succeeded ${describeAge(at.getTime() - lastOkAt)}`
      }`;
      if (await claim(db, name, kind, day, line, at.getTime())) fresh.push({ name, kind, line });
      else deduped.push(name);
    }
  } catch (error) {
    logEvent("cron_alert_failed", { error }, { level: "error" });
    return { alerted: [], deduped, mailed: false };
  }
  try {
    await db
      .prepare(PRUNE)
      .bind(new Date(at.getTime() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10))
      .run();
  } catch {
    // Housekeeping only.
  }
  if (fresh.length === 0) return { alerted: [], deduped, mailed: false };
  const outcome = await sendEmail(mail, {
    from,
    to,
    subject: `${site}: ${fresh.length === 1 ? `cron ${fresh[0].kind} (${fresh[0].name})` : `${fresh.length} cron jobs not well`}`,
    text: `${fresh.map((f) => f.line).join("\n")}\n\nEach job is mailed once per day until it is well.`,
  });
  if (!outcome.sent) {
    for (const { name, kind } of fresh)
      await db
        .prepare(RELEASE)
        .bind(name, kind, day)
        .run()
        .catch(() => undefined);
    return { alerted: [], deduped, mailed: false };
  }
  return { alerted: fresh.map((f) => f.name), deduped, mailed: true };
}

/**
 * Claim the one slot per job, kind and day: true means this caller may mail it.
 * @param {import("./cron.d.mts").D1Like} db
 * @param {string} name
 * @param {string} kind
 * @param {string} day
 * @param {string} detail
 * @param {number} at
 */
async function claim(db, name, kind, day, detail, at) {
  try {
    const result = /** @type {{ meta?: { changes?: number } } | undefined} */ (
      await db.prepare(CLAIM).bind(name, kind, day, detail, at).run()
    );
    return result?.meta?.changes !== 0;
  } catch (error) {
    logEvent("cron_alert_claim_failed", { name, error }, { level: "error" });
    return true;
  }
}
