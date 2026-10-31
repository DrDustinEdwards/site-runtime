/**
 * The one receiver for the reports a site's headers ask for, at /csp-report (CSP_REPORT_PATH, ./csp): Content-Security-Policy
 * violations, Integrity-Policy's `integrity-violation` (a script with no integrity, S2) and COEP's `coep` (a
 * subresource the embedder policy refused or would refuse, I3). Every site names it (buildContentSecurityPolicy requires one):
 *
 * - A POST always gets 204, even when it is too large, unreadable or rate-limited: an error status makes browsers
 *   send the report again.
 * - The body is read up to 16 KB and no further, whatever Content-Length claims; a real report is well under 2 kB.
 * - At most 10 violations are logged from one request, one JSON line each, with every URL cut to its origin and
 *   path, so no query string reaches the log, and no address, user agent or cookie is ever logged.
 * - The site's own limiter, when it passes one, is asked first, so nobody can fill the logs. A receiver with no `allow`
 *   still works (Capsomer calls it so today, and refusing would end its reports in silence), but logs
 *   `csp_report_unlimited` once per isolate as a warning, so the gap shows in the site's logs.
 * - A violation whose blocked URL or source file is a browser extension's or the browser's own (chrome-extension:,
 *   moz-extension:, safari-extension:, safari-web-extension:, ms-browser-extension:, resource:, file:, jar:, about:)
 *   is dropped: the site can do nothing about it (Dropbox, "On CSP reporting and filtering").
 * - The first time an isolate sees a (directive, blocked origin) pair it logs `csp_new_blocked` as a warning, so a log
 *   alert on that event hears of a new blocked host without counting every repeat.
 * - Nothing is stored: a store the internet can write to is a storage-exhaustion primitive.
 *
 * Both wire formats are read: report-uri's `{"csp-report": {...}}` (application/csp-report) and the Reporting API's
 * array of `{type, body}` (application/reports+json), of the three types above; any other type (deprecation,
 * intervention) is dropped.
 */

import { readCapped } from "./body.mjs";
import { logEvent } from "./log.mjs";

let warnedUnlimited = false;

/** The browser's own and extensions' schemes, whose violations no site can act on. */
const NOISE = /^(chrome-extension|moz-extension|safari-extension|safari-web-extension|ms-browser-extension|resource|file|jar|about):/i;

/** The (directive, blocked origin) pairs this isolate has seen, capped so a flood cannot grow it without end. */
const seen = new Set();
const MAX_SEEN = 1000;

/** The largest body read; the rest is never read. */
export const MAX_REPORT_BYTES = 16_384;

/** The most violations logged from one request. */
export const MAX_REPORTS = 10;

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * A URL cut to its origin and path. A keyword such as "inline", "eval" or "data" is kept, to 64 characters.
 * @param {unknown} value
 * @returns {string | undefined}
 */
export function trimReportUrl(value) {
  if (typeof value !== "string" || value === "") return undefined;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.slice(0, 64);
  }
}

/** The Reporting API types the receiver keeps: what the policy, Integrity-Policy and COEP report. */
const KEPT = new Set(["csp-violation", "integrity-violation", "coep"]);

/**
 * The reports in a parsed body, in either format, each with its type: the Reporting API's csp-violation,
 * integrity-violation and coep reports, or report-uri's one csp-report. Anything else is no reports.
 * @param {unknown} parsed
 * @returns {{ type: string, body: Record<string, unknown> }[]}
 */
export function reportBodies(parsed) {
  if (Array.isArray(parsed)) {
    return parsed
      .filter((r) => isObject(r) && typeof r.type === "string" && KEPT.has(r.type) && isObject(r.body))
      .map((r) => ({ type: /** @type {string} */ (r.type), body: /** @type {Record<string, unknown>} */ (r.body) }));
  }
  if (isObject(parsed) && isObject(parsed["csp-report"])) return [{ type: "csp-violation", body: /** @type {Record<string, unknown>} */ (parsed["csp-report"]) }];
  return [];
}

/**
 * One report as the line the receiver logs: what refused it (the CSP directive, Integrity-Policy's
 * `blocked-destinations`, or the COEP check: corp, navigation, worker initialization), what was blocked, the page, the
 * script and line, the request's destination, and whether it was enforced or only reported. Each field is read under
 * the Reporting API's name or report-uri's.
 * @param {Record<string, unknown>} body
 * @param {string} [type] the report's type (default csp-violation)
 */
export function summarizeReport(body, type = "csp-violation") {
  const field = (/** @type {string[]} */ ...names) => names.map((n) => body[n]).find((v) => v !== undefined);
  const line = field("lineNumber", "line-number");
  const disposition = field("disposition");
  const refusedBy =
    type === "integrity-violation" ? "blocked-destinations" : type === "coep" ? field("type") : field("effectiveDirective", "effective-directive", "violatedDirective", "violated-directive");
  const destination = field("destination");
  return {
    event: type,
    directive: String(refusedBy ?? "").slice(0, 64) || undefined,
    blocked: trimReportUrl(field("blockedURL", "blocked-uri")),
    page: trimReportUrl(field("documentURL", "document-uri")),
    source: trimReportUrl(field("sourceFile", "source-file")),
    line: typeof line === "number" ? line : undefined,
    ...(typeof destination === "string" ? { destination: destination.slice(0, 32) } : {}),
    disposition:
      disposition === "enforce" || body.reportOnly === false ? "enforce" : disposition === "report" || disposition === "reporting" || body.reportOnly === true ? "report" : undefined,
  };
}

/**
 * The body as text, at most `max` bytes; null when it is longer or unreadable (a report that cannot be read is
 * dropped, never retried).
 * @param {Request} request @param {number} max
 * @returns {Promise<string | null>}
 */
async function readReport(request, max) {
  try {
    return await readCapped(request, max);
  } catch {
    return null;
  }
}

/**
 * @typedef {{
 *   allow?: (request: Request) => boolean | Promise<boolean>,
 *   allowOrigin?: string,
 *   headers?: Readonly<Record<string, string>>,
 *   log?: (line: Record<string, unknown>) => void,
 * }} ReceiveOptions
 *   `allow`: the site's rate limiter; false drops the report, still with 204. `allowOrigin`: the one origin whose
 *   pages report here from another host (Carrel's pages report to its AI door); it gets the Reporting API's CORS
 *   preflight. `headers`: the site's security set, put on every response. `log`: where lines go (console.log).
 */

/**
 * Receives one report request and answers it. POST is 204, OPTIONS is the preflight (204, CORS only for
 * `allowOrigin`), anything else is 405.
 * @param {Request} request
 * @param {ReceiveOptions} [options]
 * @returns {Promise<Response>}
 */
export async function receiveCspReport(request, { allow, allowOrigin, headers = {}, log = (line) => console.log(JSON.stringify(line)) } = {}) {
  /** @type {Record<string, string>} */
  const cors = allowOrigin && request.headers.get("Origin") === allowOrigin
    ? { "Access-Control-Allow-Origin": allowOrigin, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" }
    : {};
  const answer = (/** @type {number} */ status, /** @type {Record<string, string>} */ extra = {}) =>
    new Response(null, { status, headers: { ...headers, ...cors, "Cache-Control": "no-store", ...extra } });

  if (request.method === "OPTIONS") return answer(204);
  if (request.method !== "POST") return answer(405, { Allow: "POST, OPTIONS" });
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_REPORT_BYTES) return answer(204);
  if (allow && !(await allow(request))) return answer(204);
  if (!allow && !warnedUnlimited) {
    warnedUnlimited = true;
    logEvent("csp_report_unlimited", { note: "receiveCspReport has no allow: pass the site's rate limiter" }, { level: "warn" });
  }
  const text = await readReport(request, MAX_REPORT_BYTES);
  if (text === null) return answer(204);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return answer(204);
  }
  for (const { type, body } of reportBodies(parsed).slice(0, MAX_REPORTS)) {
    const raw = ["blockedURL", "blocked-uri", "sourceFile", "source-file"].map((n) => body[n]);
    if (raw.some((v) => typeof v === "string" && NOISE.test(v))) continue;
    const line = summarizeReport(body, type);
    log(line);
    const blocked = line.blocked && /^https?:/.test(line.blocked) ? new URL(line.blocked).origin : line.blocked;
    const key = `${line.directive} ${blocked}`;
    if (!seen.has(key) && seen.size < MAX_SEEN) {
      seen.add(key);
      logEvent("csp_new_blocked", { directive: line.directive, blocked }, { level: "warn" });
    }
  }
  return answer(204);
}
