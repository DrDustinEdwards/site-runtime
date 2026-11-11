/**
 * Tell a person once when a check changes state: each run's results are compared with the stored state, a mail goes
 * out only when a check flips (one seen for the first time counts only when it fails), and the new states are recorded
 * only after the mail went, so a failed mail is tried again on the next run instead of losing the alert. From Carrel's
 * runHealth (app/lib/health.server.ts); the table is Carrel's `health_state`.
 */

import { logEvent } from "./log.mjs";

/** The migration: a D1 site adds it as its next file. `ok` is 0 or 1; `changed_at` an ISO time. */
export const HEALTH_STATE_SQL = `CREATE TABLE IF NOT EXISTS health_state (
  check_name TEXT PRIMARY KEY NOT NULL,
  ok INTEGER NOT NULL,
  detail TEXT NOT NULL,
  changed_at TEXT NOT NULL
);
`;

const UPSERT = `INSERT INTO health_state (check_name, ok, detail, changed_at) VALUES (?1, ?2, ?3, ?4)
ON CONFLICT (check_name) DO UPDATE SET ok = excluded.ok, detail = excluded.detail, changed_at = excluded.changed_at`;

/**
 * Mail when any check changed state, then record the states that changed or are new.
 * @param {{
 *   db: import("./cron.d.mts").D1Like,
 *   results: { name: string, ok: boolean, detail: string }[],
 *   send: (mail: { subject: string, text: string }) => Promise<boolean>,
 *   site: string,
 *   now?: () => Date,
 * }} options `send` answers whether the mail went; `site` names the site in the subject
 * @returns {Promise<{ emailed: boolean, changed: string[] }>}
 */
export async function notifyOnChange({ db, results, send, site, now = () => new Date() }) {
  /** @type {Map<string, boolean>} */
  let previous;
  try {
    const { results: rows } = await db
      .prepare("SELECT check_name, ok FROM health_state")
      .bind()
      .all();
    previous = new Map(
      /** @type {{ check_name: string, ok: number }[]} */ (rows).map((r) => [
        r.check_name,
        Boolean(r.ok),
      ]),
    );
  } catch {
    previous = new Map();
  }
  const changed = results.filter((r) => {
    const before = previous.get(r.name);
    return before === undefined ? !r.ok : before !== r.ok;
  });
  const unseen = results.filter((r) => !previous.has(r.name));
  const names = changed.map((r) => r.name);
  if (changed.length === 0 && unseen.length === 0) return { emailed: false, changed: names };

  let emailed = false;
  if (changed.length > 0) {
    const failing = results.filter((r) => !r.ok).length;
    const sent = await send({
      subject:
        failing === 0
          ? `${site}: all checks pass`
          : `${site}: ${failing} check${failing === 1 ? "" : "s"} failing`,
      text: results.map((r) => `${r.ok ? "ok  " : "FAIL"} ${r.name}: ${r.detail}`).join("\n"),
    });
    if (!sent) return { emailed: false, changed: names };
    emailed = true;
  }
  const at = now().toISOString();
  try {
    for (const r of new Set([...changed, ...unseen]))
      await db
        .prepare(UPSERT)
        .bind(r.name, r.ok ? 1 : 0, r.detail, at)
        .run();
  } catch (error) {
    logEvent("health_state_write_failed", { error }, { level: "error" });
  }
  return { emailed, changed: names };
}
