/** @param {CrawlOptions} opts @returns {Promise<CrawlResult>} */
export function crawlApp(opts: CrawlOptions): Promise<CrawlResult>;
/** @param {() => Promise<CrawlResult>} run @returns {Promise<CrawlResult>} */
export function guardedCrawl(run: () => Promise<CrawlResult>): Promise<CrawlResult>;
/**
 * @param {Record<string, CrawlResult>} sites
 * @param {{ at: Date, ref: string }} meta
 * @returns {{ check: "signed-in-security", at: string, ref: string, sites: Record<string, CrawlResult> }}
 */
export function signedInReport(sites: Record<string, CrawlResult>, meta: {
    at: Date;
    ref: string;
}): {
    check: "signed-in-security";
    at: string;
    ref: string;
    sites: Record<string, CrawlResult>;
};
/** One line for a log: each host's status and error count. @param {{ sites: Record<string, CrawlResult> }} report */
export function signedInSummary(report: {
    sites: Record<string, CrawlResult>;
}): string;
/** The stored report as GET SIGNED_IN_REPORT_PATH serves it, or a 404 before the first run. Public: findings only.
 *  @param {string | null | undefined} body */
export function signedInReportResponse(body: string | null | undefined): Response;
/**
 * @typedef {object} CrawlFinding
 * @property {"error" | "warning"} severity
 * @property {string} check A checklist item (checkSecurityHeaders' id, R4, I3), or "session" / "crawl" when the crawl could not run.
 * @property {string} detail
 */
/**
 * @typedef {object} CrawlResult
 * @property {"pass" | "fail" | "error"} status
 * @property {CrawlFinding[]} findings
 */
/**
 * @typedef {object} CrawlOptions
 * @property {string} origin The app's origin, as its registry entry names it.
 * @property {(request: Request) => Promise<Response>} fetch The app's own fetch: its handler in-process, or the network.
 * @property {Record<string, string>} headers What signs the request in (a session cookie, Access service-token headers). Never reported.
 * @property {string[]} pages Pages, the first being the signed-in home: a redirect, 401 or 403 there makes the result "error".
 * @property {string[]} [json] JSON reads, graded as subresources.
 * @property {string[]} [actions] JSON actions probed for R4 with a text/plain and a form body, each of which must get 415.
 * @property {string} [r4Note] A warning to add for R4 when the app is not probed, saying why.
 */
export const SIGNED_IN_CHECK: "signed-in-security";
export const SIGNED_IN_REPORT_PATH: "/reports/signed-in-security.json";
export const SIGNED_IN_MISSING_PATH: "/signed-in-crawl-404";
export type CrawlFinding = {
    severity: "error" | "warning";
    /**
     * A checklist item (checkSecurityHeaders' id, R4, I3), or "session" / "crawl" when the crawl could not run.
     */
    check: string;
    detail: string;
};
export type CrawlResult = {
    status: "pass" | "fail" | "error";
    findings: CrawlFinding[];
};
export type CrawlOptions = {
    /**
     * The app's origin, as its registry entry names it.
     */
    origin: string;
    /**
     * The app's own fetch: its handler in-process, or the network.
     */
    fetch: (request: Request) => Promise<Response>;
    /**
     * What signs the request in (a session cookie, Access service-token headers). Never reported.
     */
    headers: Record<string, string>;
    /**
     * Pages, the first being the signed-in home: a redirect, 401 or 403 there makes the result "error".
     */
    pages: string[];
    /**
     * JSON reads, graded as subresources.
     */
    json?: string[] | undefined;
    /**
     * JSON actions probed for R4 with a text/plain and a form body, each of which must get 415.
     */
    actions?: string[] | undefined;
    /**
     * A warning to add for R4 when the app is not probed, saying why.
     */
    r4Note?: string | undefined;
};
