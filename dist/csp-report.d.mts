/**
 * A URL cut to its origin and path. A keyword such as "inline", "eval" or "data" is kept, to 64 characters.
 * @param {unknown} value
 * @returns {string | undefined}
 */
export function trimReportUrl(value: unknown): string | undefined;
/**
 * The `web-vital` entry as the line the receiver logs: INP only (Cloudflare Web Analytics already reports LCP and CLS),
 * its value and rating, the three subparts, the longest script and the style and layout work. Anything else is null.
 * @param {Record<string, unknown>} body
 * @returns {{ event: "web_vital"; name: "INP"; value: number | undefined; rating: string | undefined; page: string | undefined; target: string | undefined; input_delay: number | undefined; processing: number | undefined; presentation: number | undefined; script: string | undefined; script_function: string | undefined; script_char: number | undefined; invoker: string | undefined; script_subpart: string | undefined; script_overlap: number | undefined; forced_style_layout: number | undefined; style_layout: number | undefined } | null}
 */
export function summarizeVital(body: Record<string, unknown>): {
    event: "web_vital";
    name: "INP";
    value: number | undefined;
    rating: string | undefined;
    page: string | undefined;
    target: string | undefined;
    input_delay: number | undefined;
    processing: number | undefined;
    presentation: number | undefined;
    script: string | undefined;
    script_function: string | undefined;
    script_char: number | undefined;
    invoker: string | undefined;
    script_subpart: string | undefined;
    script_overlap: number | undefined;
    forced_style_layout: number | undefined;
    style_layout: number | undefined;
} | null;
/**
 * The reports in a parsed body, in either format, each with its type: the Reporting API's csp-violation,
 * integrity-violation and coep reports, or report-uri's one csp-report. Anything else is no reports.
 * @param {unknown} parsed
 * @returns {{ type: string, body: Record<string, unknown> }[]}
 */
export function reportBodies(parsed: unknown): {
    type: string;
    body: Record<string, unknown>;
}[];
/**
 * One report as the line the receiver logs: what refused it (the CSP directive, Integrity-Policy's
 * `blocked-destinations`, or the COEP check: corp, navigation, worker initialization), what was blocked, the page, the
 * script and line, the request's destination, and whether it was enforced or only reported. Each field is read under
 * the Reporting API's name or report-uri's.
 * @param {Record<string, unknown>} body
 * @param {string} [type] the report's type (default csp-violation)
 * @returns {{ event: string; directive: string | undefined; blocked: string | undefined; page: string | undefined; source: string | undefined; line: number | undefined; column?: number; sink?: string; destination?: string; disposition: "enforce" | "report" | undefined }}
 */
export function summarizeReport(body: Record<string, unknown>, type?: string): {
    event: string;
    directive: string | undefined;
    blocked: string | undefined;
    page: string | undefined;
    source: string | undefined;
    line: number | undefined;
    column?: number;
    sink?: string;
    destination?: string;
    disposition: "enforce" | "report" | undefined;
};
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
 * The `allow` for a Workers Rate Limiting binding (`ratelimits` in wrangler.jsonc), keyed on the edge-set client address,
 * which is counted and never logged. A missing binding drops every report (still 204) rather than leaving the sink open.
 * @param {{ limit(options: { key: string }): Promise<{ success: boolean }> } | undefined} binding
 * @returns {(request: Request) => Promise<boolean>}
 */
export function rateLimitAllow(binding: {
    limit(options: {
        key: string;
    }): Promise<{
        success: boolean;
    }>;
} | undefined): (request: Request) => Promise<boolean>;
/**
 * Receives one report request and answers it. POST is 204, OPTIONS is the preflight (204, CORS only for
 * `allowOrigin`), anything else is 405.
 * @param {Request} request
 * @param {ReceiveOptions} [options]
 * @returns {Promise<Response>}
 */
export function receiveCspReport(request: Request, { allow, allowOrigin, headers, log }?: ReceiveOptions): Promise<Response>;
/** The largest body read; the rest is never read. */
export const MAX_REPORT_BYTES: 16384;
/** The most violations logged from one request. */
export const MAX_REPORTS: 10;
/**
 * `allow`: the site's rate limiter; false drops the report, still with 204. `allowOrigin`: the one origin whose
 * pages report here from another host (Carrel's pages report to its AI door); it gets the Reporting API's CORS
 * preflight. `headers`: the site's security set, put on every response. `log`: where lines go (console.log).
 */
export type ReceiveOptions = {
    allow?: (request: Request) => boolean | Promise<boolean>;
    allowOrigin?: string;
    headers?: Readonly<Record<string, string>>;
    log?: (line: Record<string, unknown>) => void;
};
