/** One mail a day about each job that is not well (cron-alert.mjs), deduped in D1 `cron_alerts`. */
import type { D1Like } from "./cron.mjs";
import type { EmailBinding, MailAddress } from "./email.mjs";

/** The migration: `cron_alerts` (job, kind, day, detail, created_at), one row per job, kind and UTC day. */
export const CRON_ALERTS_SQL: string;
/** An age in words: "5 minutes ago", "3 hours ago". */
export function describeAge(ms: number): string;
/**
 * Mail what cronFindings names, each job at most once per kind ("failure" or "stale") per UTC day, as one message through
 * the send_email binding. A failed mail gives its claims back. Never throws.
 */
export function cronAlert(options: {
  db: D1Like;
  mail: EmailBinding | null | undefined;
  from: MailAddress;
  to: MailAddress | MailAddress[];
  site: string;
  jobs?: Array<{ name: string; everyMinutes: number | null }>;
  deployedAt?: Date;
  graceMinutes?: number;
  now?: Date;
}): Promise<{ alerted: string[]; deduped: string[]; mailed: boolean }>;
