/**
 * Mail when any check changed state, then record the states that changed or are new.
 * @param {{
 *   db: import("./cron.mjs").D1Like,
 *   results: { name: string, ok: boolean, detail: string }[],
 *   send: (mail: { subject: string, text: string }) => Promise<boolean>,
 *   site: string,
 *   now?: () => Date,
 * }} options `send` answers whether the mail went; `site` names the site in the subject
 * @returns {Promise<{ emailed: boolean, changed: string[] }>}
 */
export function notifyOnChange({ db, results, send, site, now }: {
    db: import("./cron.mjs").D1Like;
    results: {
        name: string;
        ok: boolean;
        detail: string;
    }[];
    send: (mail: {
        subject: string;
        text: string;
    }) => Promise<boolean>;
    site: string;
    now?: () => Date;
}): Promise<{
    emailed: boolean;
    changed: string[];
}>;
/** The migration: a D1 site adds it as its next file. `ok` is 0 or 1; `changed_at` an ISO time. */
export const HEALTH_STATE_SQL: "CREATE TABLE IF NOT EXISTS health_state (\n  check_name TEXT PRIMARY KEY NOT NULL,\n  ok INTEGER NOT NULL,\n  detail TEXT NOT NULL,\n  changed_at TEXT NOT NULL\n);\n";
