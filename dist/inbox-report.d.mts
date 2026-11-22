/**
 * Capsid's origin, from the var CAPSID_ORIGIN, trailing slashes cut; read loosely, for an older config without it.
 * @param {unknown} env
 * @returns {string}
 */
export function capsidOrigin(env: unknown): string;
/**
 * Sends one report. Skipped (no request) without a key. Never throws.
 * @param {{ namespace: string, items: InboxItem[], key: string | undefined, origin?: string, fetcher?: typeof fetch }} report
 * @returns {Promise<ReportResult>}
 */
export function reportInbox({ namespace, items, key, origin, fetcher, }: {
    namespace: string;
    items: InboxItem[];
    key: string | undefined;
    origin?: string;
    fetcher?: typeof fetch;
}): Promise<ReportResult>;
/**
 * An app's report to Capsid's inbox (inbox-report.mjs): POST /ops/inbox/report with the app's agent key.
 * @typedef {object} InboxItem
 * @property {string} title The app's words; cut to 200 characters.
 * @property {string} [link] On the app's own origin; the receiver refuses any other.
 * @property {string} [since] ISO time the oldest waiting thing began.
 */
/**
 * @typedef {object} ReportResult
 * @property {"skipped" | "sent" | "failed"} state
 * @property {string} detail
 */
/** Where the report goes, on Capsid's origin. */
export const INBOX_REPORT_PATH: "/ops/inbox/report";
/** The receiver's limits: items per report, characters per title, bytes per body. */
export const MAX_REPORT_ITEMS: 20;
export const MAX_REPORT_TITLE: 200;
export const MAX_INBOX_REPORT_BYTES: 16384;
/** How long Capsid keeps a report: an app that stops reporting stops being counted. */
export const REPORT_TTL_SECONDS: number;
/**
 * An app's report to Capsid's inbox (inbox-report.mjs): POST /ops/inbox/report with the app's agent key.
 */
export type InboxItem = {
    /**
     * The app's words; cut to 200 characters.
     */
    title: string;
    /**
     * On the app's own origin; the receiver refuses any other.
     */
    link?: string | undefined;
    /**
     * ISO time the oldest waiting thing began.
     */
    since?: string | undefined;
};
export type ReportResult = {
    state: "skipped" | "sent" | "failed";
    detail: string;
};
