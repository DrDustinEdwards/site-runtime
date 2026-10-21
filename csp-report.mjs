/**
 * The one receiver for Content-Security-Policy violation reports, for every site that names a report sink in its
 * policy (buildContentSecurityPolicy requires one):
 *
 * - A POST always gets 204, even when it is too large, unreadable or rate-limited: an error status makes browsers
 *   send the report again.
 * - The body is read up to 16 KB and no further, whatever Content-Length claims; a real report is well under 2 kB.
 * - At most 10 violations are logged from one request, one JSON line each, with every URL cut to its origin and
 *   path, so no query string reaches the log, and no address, user agent or cookie is ever logged.
 * - The site's own limiter, when it passes one, is asked first, so nobody can fill the logs.
 * - Nothing is stored: a store the internet can write to is a storage-exhaustion primitive.
 *
 * Both wire formats are read: report-uri's `{"csp-report": {...}}` (application/csp-report) and the Reporting API's
 * array of `{type: "csp-violation", body}` (application/reports+json).
 */

import { readCapped } from "./body.mjs";

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

/**
 * The violations in a parsed report body, in either format; anything else is no violations.
 * @param {unknown} parsed
 * @returns {Record<string, unknown>[]}
 */
export function cspViolations(parsed) {
  if (Array.isArray(parsed)) {
    return parsed.filter((r) => isObject(r) && r.type === "csp-violation" && isObject(r.body)).map((r) => /** @type {Record<string, unknown>} */ (r.body));
  }
  if (isObject(parsed) && isObject(parsed["csp-report"])) return [/** @type {Record<string, unknown>} */ (parsed["csp-report"])];
  return [];
}

/**
 * One violation as the line the receiver logs: the directive, what was blocked, the page, the script and line, and
 * whether it was enforced or only reported. Each field is read under the Reporting API's name or report-uri's.
 * @param {Record<string, unknown>} body
 */
export function summarizeViolation(body) {
  const field = (/** @type {string[]} */ ...names) => names.map((n) => body[n]).find((v) => v !== undefined);
  const line = field("lineNumber", "line-number");
  const disposition = field("disposition");
  return {
    event: "csp-violation",
    directive: String(field("effectiveDirective", "effective-directive", "violatedDirective", "violated-directive") ?? "").slice(0, 64) || undefined,
    blocked: trimReportUrl(field("blockedURL", "blocked-uri")),
    page: trimReportUrl(field("documentURL", "document-uri")),
    source: trimReportUrl(field("sourceFile", "source-file")),
    line: typeof line === "number" ? line : undefined,
    disposition: disposition === "enforce" || disposition === "report" ? disposition : undefined,
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
  const text = await readReport(request, MAX_REPORT_BYTES);
  if (text === null) return answer(204);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return answer(204);
  }
  for (const body of cspViolations(parsed).slice(0, MAX_REPORTS)) log(summarizeViolation(body));
  return answer(204);
}
