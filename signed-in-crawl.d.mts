/** The signed-in crawl (signed-in-crawl.mjs): an app grades its own pages behind the sign-in and reports them. */

export const SIGNED_IN_CHECK: "signed-in-security";
export const SIGNED_IN_REPORT_PATH: "/reports/signed-in-security.json";
/** A path no app serves, for the signed-in 404. */
export const SIGNED_IN_MISSING_PATH: string;

export interface CrawlFinding {
  severity: "error" | "warning";
  /** A checklist item (checkSecurityHeaders' id, R4, I3), or "session" / "crawl" when the crawl could not run. */
  check: string;
  detail: string;
}
export interface CrawlResult {
  status: "pass" | "fail" | "error";
  findings: CrawlFinding[];
}
export interface CrawlOptions {
  /** The app's origin, as its registry entry names it. */
  origin: string;
  /** The app's own fetch: its handler in-process, or the network. */
  fetch: (request: Request) => Promise<Response>;
  /** What signs the request in (a session cookie, Access service-token headers). Never reported. */
  headers: Record<string, string>;
  /** Pages, the first being the signed-in home: a redirect, 401 or 403 there makes the result "error". */
  pages: string[];
  /** JSON reads, graded as subresources. */
  json?: string[];
  /** JSON actions probed for R4 with a text/plain and a form body, each of which must get 415. */
  actions?: string[];
  /** A warning to add for R4 when the app is not probed, saying why. */
  r4Note?: string;
}

/** Crawls one app's signed-in pages and grades them against its registry entry. */
export function crawlApp(opts: CrawlOptions): Promise<CrawlResult>;
/** The crawl's result, or "error" with the reason when it throws. */
export function guardedCrawl(run: () => Promise<CrawlResult>): Promise<CrawlResult>;
/** The report devkit's scoreboard reads: { check, at, ref, sites }. */
export function signedInReport(
  sites: Record<string, CrawlResult>,
  meta: { at: Date; ref: string },
): { check: "signed-in-security"; at: string; ref: string; sites: Record<string, CrawlResult> };
/** One line for a log: each host's status and error count. */
export function signedInSummary(report: { sites: Record<string, CrawlResult> }): string;
/** The stored report body as a public, no-store JSON response, or a 404 before the first run. */
export function signedInReportResponse(body: string | null | undefined): Response;
