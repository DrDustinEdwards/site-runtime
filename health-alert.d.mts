/** One mail when a check changes state (health-alert.mjs), states kept in D1 `health_state`. */
import type { D1Like } from "./cron.mjs";

export const HEALTH_STATE_SQL: string;
/** Mail when any check flipped (a new one only when failing), then record the changed and new states. */
export function notifyOnChange(options: {
  db: D1Like;
  results: { name: string; ok: boolean; detail: string }[];
  send: (mail: { subject: string; text: string }) => Promise<boolean>;
  site: string;
  now?: () => Date;
}): Promise<{ emailed: boolean; changed: string[] }>;
