/** Alerts raised at most once a day (cron-alert.mjs), deduped in D1 `alerts_sent`. */
import type { D1Like, CronFindingsOptions } from "./cron.mjs";
import type { EmailBinding, MailAddress } from "./email.mjs";

/** The migration: `alerts_sent` (key, kind, day, detail, created_at), one row per key, kind and UTC day. */
export const ALERTS_SQL: string;
/** An age in words: "5 minutes ago", "3 hours ago". */
export function describeAge(ms: number): string;

/** What an alert did: sent, already sent today, or a send that did not go (its slot given back). */
export type AlertOutcome =
  | { sent: true }
  | { sent: false; reason: "deduped" }
  | { sent: false; reason: "send_failed"; error: string };

/** What a site's `send` returns: true, or `{ sent, error }`. A throw counts as not sent. */
export type AlertSent = boolean | { sent: boolean; error?: string };

/** One job cronFindings names, with the line the default mail writes for it. */
export interface CronAlertItem {
  name: string;
  kind: "failure" | "stale";
  reason: "failed" | "stale" | "never succeeded" | "never ran";
  lastOkAt: number | null;
  line: string;
}

/**
 * Raise one alert at most once per key, kind and UTC day: claim the slot, send, give the slot back when the send did
 * not go. Never throws.
 */
export function alertOnce(options: {
  db: D1Like;
  key: string;
  kind: string;
  detail?: string;
  now?: Date;
  send: () => Promise<AlertSent>;
}): Promise<AlertOutcome>;

/**
 * Alert on what cronFindings names, each job at most once per kind ("failure" or "stale") per UTC day: one message
 * through the send_email binding (`mail`, `from`, `to`, `site`), or the site's own `send`, given the new alerts at
 * once or, with `each`, one per call. A send that did not go gives its claims back. Never throws.
 */
export function cronAlert(
  options: {
    db: D1Like;
    mail?: EmailBinding | null | undefined;
    from?: MailAddress;
    to?: MailAddress | MailAddress[];
    site?: string;
    send?: (alerts: CronAlertItem[]) => Promise<AlertSent>;
    each?: boolean;
  } & Pick<CronFindingsOptions, "jobs" | "deployedAt" | "graceMinutes" | "now">,
): Promise<{ found: CronAlertItem[]; alerted: string[]; deduped: string[]; mailed: boolean }>;
