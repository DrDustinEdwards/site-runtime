/**
 * An age in words, as Foxhound wrote it: "5 minutes ago", "3 hours ago".
 * @param {number} ms
 */
export function describeAge(ms: number): string;
/**
 * @typedef {{ name: string, kind: "failure" | "stale", reason: "failed" | "stale" | "never succeeded" | "never ran", lastOkAt: number | null, line: string }} CronAlertItem
 * @typedef {{ sent: true } | { sent: false, reason: "deduped" } | { sent: false, reason: "send_failed", error: string }} AlertOutcome
 */
/**
 * Raise one alert at most once per key, kind and UTC day: claim the day's slot, `send`, and give the slot back when the
 * send did not go, so the next try sends. `send` resolves true (or `{ sent: true }`) when it went. Never throws.
 * @param {{
 *   db: import("./cron.mjs").D1Like,
 *   key: string,
 *   kind: string,
 *   detail?: string,
 *   now?: Date,
 *   send: () => Promise<boolean | { sent: boolean, error?: string }>,
 * }} options
 * @returns {Promise<AlertOutcome>}
 */
export function alertOnce({ db, key, kind, detail, now, send }: {
    db: import("./cron.mjs").D1Like;
    key: string;
    kind: string;
    detail?: string;
    now?: Date;
    send: () => Promise<boolean | {
        sent: boolean;
        error?: string;
    }>;
}): Promise<AlertOutcome>;
/**
 * Mail the jobs cronFindings names, each at most once per kind per UTC day. By default as one message through the
 * send_email binding (`mail`, `from`, `to`, `site`); with `send`, the site sends instead, given the new alerts all at once
 * or, with `each`, one alert per call. Never throws.
 * @param {{
 *   db: import("./cron.mjs").D1Like,
 *   mail?: import("./email.mjs").EmailBinding | null | undefined,
 *   from?: import("./email.mjs").MailAddress,
 *   to?: import("./email.mjs").MailAddress | import("./email.mjs").MailAddress[],
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
export function cronAlert({ db, mail, from, to, site, send, each, jobs, deployedAt, graceMinutes, now, }: {
    db: import("./cron.mjs").D1Like;
    mail?: import("./email.mjs").EmailBinding | null | undefined;
    from?: import("./email.mjs").MailAddress;
    to?: import("./email.mjs").MailAddress | import("./email.mjs").MailAddress[];
    site?: string;
    send?: (alerts: CronAlertItem[]) => Promise<boolean | {
        sent: boolean;
        error?: string;
    }>;
    each?: boolean;
    jobs?: Array<{
        name: string;
        everyMinutes: number | null;
    }>;
    deployedAt?: Date;
    graceMinutes?: number | ((everyMinutes: number) => number);
    now?: Date;
}): Promise<{
    found: CronAlertItem[];
    alerted: string[];
    deduped: string[];
    mailed: boolean;
}>;
/**
 * What a site's `send` returns: true, or `{ sent, error }`. A throw counts as not sent.
 * @typedef {boolean | { sent: boolean; error?: string }} AlertSent
 */
/** The migration: a D1 site adds it as its next file. `key` is what the alert is about (a job's name, a queue), `day`
 *  the UTC date, YYYY-MM-DD. */
export const ALERTS_SQL: "CREATE TABLE IF NOT EXISTS alerts_sent (\n  key TEXT NOT NULL,\n  kind TEXT NOT NULL,\n  day TEXT NOT NULL,\n  detail TEXT,\n  created_at INTEGER NOT NULL,\n  PRIMARY KEY (key, kind, day)\n);\n";
export type CronAlertItem = {
    name: string;
    kind: "failure" | "stale";
    reason: "failed" | "stale" | "never succeeded" | "never ran";
    lastOkAt: number | null;
    line: string;
};
export type AlertOutcome = {
    sent: true;
} | {
    sent: false;
    reason: "deduped";
} | {
    sent: false;
    reason: "send_failed";
    error: string;
};
/**
 * What a site's `send` returns: true, or `{ sent, error }`. A throw counts as not sent.
 */
export type AlertSent = boolean | {
    sent: boolean;
    error?: string;
};
