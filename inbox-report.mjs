/**
 * What an app reports about itself to Capsid's inbox (POST /ops/inbox/report): the things that need Dustin that live
 * only in the app's own database (Carrel's AI drafts waiting), for the badge in the shared AdminShell. Capsid's
 * receiver (capsid src/inbox-report.ts) owns the contract: a report replaces the last one whole and expires after 6
 * hours, so an app sends its present state every cron run and sends no items when nothing waits, which clears the
 * badge. The bearer is the app's own Capsid agent key (CAPSID_AGENT_KEY), with the write grant on its namespace.
 *
 * Never on a page's path: a failure is logged and returned, never thrown, so a cron job decides what a failure means.
 * Items over the receiver's limits are cut here (20 items, 200-character titles), since the receiver refuses the
 * whole report for one item outside them.
 */

import { timedFetch } from "./http.mjs";
import { logEvent } from "./log.mjs";

/** Where the report goes, on Capsid's origin. */
export const INBOX_REPORT_PATH = "/ops/inbox/report";
/** Capsid's origin when the app's config names none. */
export const CAPSID_ORIGIN = "https://mcp.dustinedwards.info";
/** The receiver's limits: items per report, characters per title, bytes per body. */
export const MAX_REPORT_ITEMS = 20;
export const MAX_REPORT_TITLE = 200;
export const MAX_INBOX_REPORT_BYTES = 16384;
/** How long Capsid keeps a report: an app that stops reporting stops being counted. */
export const REPORT_TTL_SECONDS = 6 * 3600;

/**
 * Capsid's origin, from the var CAPSID_ORIGIN, trailing slashes cut; read loosely, for an older config without it.
 * @param {unknown} env
 * @returns {string}
 */
export function capsidOrigin(env) {
  const configured = /** @type {{ CAPSID_ORIGIN?: unknown } | null | undefined} */ (env)
    ?.CAPSID_ORIGIN;
  const origin = typeof configured === "string" ? configured.trim() : "";
  return (origin || CAPSID_ORIGIN).replace(/\/+$/, "");
}

/**
 * Sends one report. Skipped (no request) without a key. Never throws.
 * @param {{ namespace: string, items: import("./inbox-report.mjs").InboxItem[], key: string | undefined, origin?: string, fetcher?: typeof fetch }} report
 * @returns {Promise<import("./inbox-report.mjs").ReportResult>}
 */
export async function reportInbox({
  namespace,
  items,
  key,
  origin = CAPSID_ORIGIN,
  fetcher = timedFetch,
}) {
  const bearer = key?.trim();
  if (!bearer) return { state: "skipped", detail: "CAPSID_AGENT_KEY is not set." };
  const body = {
    namespace,
    items: items.slice(0, MAX_REPORT_ITEMS).map(({ title, link, since }) => ({
      title: title.slice(0, MAX_REPORT_TITLE),
      ...(link ? { link } : {}),
      ...(since ? { since } : {}),
    })),
  };
  try {
    const response = await fetcher(`${origin.replace(/\/+$/, "")}${INBOX_REPORT_PATH}`, {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Capsid answered ${response.status}`);
    return { state: "sent", detail: `${body.items.length} item(s) reported.` };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logEvent("inbox_report_failed", { namespace, error: detail }, { level: "error" });
    return { state: "failed", detail };
  }
}
