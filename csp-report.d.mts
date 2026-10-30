/**
 * The one receiver for Content-Security-Policy violation reports. A POST always gets 204; the body is read to 16 KB at most; at most 10 violations are logged,
 * each URL cut to its origin and path; extension and browser-scheme violations are dropped; a first-seen (directive, blocked
 * origin) logs `csp_new_blocked` once per isolate; the site's limiter is asked first; nothing is stored.
 */
/** The largest body read; the rest is never read. */
export const MAX_REPORT_BYTES: 16384;
/** The most violations logged from one request. */
export const MAX_REPORTS: 10;
/** A URL cut to its origin and path; a keyword such as "inline" is kept, to 64 characters. */
export function trimReportUrl(value: unknown): string | undefined;
/** The violations in a parsed report body, in either format; anything else is no violations. */
export function cspViolations(parsed: unknown): Record<string, unknown>[];
/** One violation as the line the receiver logs. */
export function summarizeViolation(body: Record<string, unknown>): {
    event: "csp-violation";
    directive: string | undefined;
    blocked: string | undefined;
    page: string | undefined;
    source: string | undefined;
    line: number | undefined;
    disposition: "enforce" | "report" | undefined;
};
/**
 * `allow`: the site's rate limiter; false drops the report, still with 204. Without it, one `csp_report_unlimited` warning per isolate. `allowOrigin`: the one origin whose
 * pages report here from another host; it gets the Reporting API's CORS preflight. `headers`: the site's security
 * set, put on every response. `log`: where lines go (console.log).
 */
export type ReceiveOptions = {
    allow?: (request: Request) => boolean | Promise<boolean>;
    allowOrigin?: string;
    headers?: Readonly<Record<string, string>>;
    log?: (line: Record<string, unknown>) => void;
};
/** Receives one report request and answers it: POST 204, OPTIONS the preflight, anything else 405. */
export function receiveCspReport(request: Request, options?: ReceiveOptions): Promise<Response>;
