/** An app's report to Capsid's inbox (inbox-report.mjs): POST /ops/inbox/report with the app's agent key. */

export interface InboxItem {
  /** The app's words; cut to 200 characters. */
  title: string;
  /** On the app's own origin; the receiver refuses any other. */
  link?: string;
  /** ISO time the oldest waiting thing began. */
  since?: string;
}

export type ReportResult = { state: "skipped" | "sent" | "failed"; detail: string };

export const INBOX_REPORT_PATH: "/ops/inbox/report";
export const MAX_REPORT_ITEMS: number;
export const MAX_REPORT_TITLE: number;
export const MAX_INBOX_REPORT_BYTES: number;
export const REPORT_TTL_SECONDS: number;

/** Capsid's origin from the CAPSID_ORIGIN var, else CAPSID_ORIGIN. */
export function capsidOrigin(env: unknown): string;
/** Sends the report (no items clears the badge). Skipped without a key; a failure is logged and returned, never thrown. */
export function reportInbox(report: {
  namespace: string;
  items: InboxItem[];
  key: string | undefined;
  origin?: string;
  fetcher?: typeof fetch;
}): Promise<ReportResult>;
