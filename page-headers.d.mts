import type { SitePolicy } from "./csp.mjs";

/** What a site's policy function is told about the response it is building the policy for. */
export type PolicyContext = {
  /** The nonce this page is rendered with (none for a response that is not a page). */
  nonce: string | undefined;
  request: Request;
  url: URL;
  /** True when the Report-Only companion is being built, so a directive a browser ignores there can be left out. */
  staged: boolean;
};

export type PageSecurityOptions = {
  /** The site's header set: `buildSecurityHeaders({ site })`, plus any header of its own. */
  set: Readonly<Record<string, string>>;
  /** The site's Content-Security-Policy for one response. report-uri and report-to are filled in when not named. */
  policy: (context: PolicyContext) => SitePolicy;
  /** What the Report-Only companion adds (the registry entry's staging, e.g. `{ trustedTypes: true, denyUnlisted: true }`), or false for none. */
  staged: Partial<SitePolicy> | false;
  /** Default CSP_REPORT_PATH. */
  reportPath?: string;
  /** Default CSP_REPORT_GROUP. */
  group?: string;
  /** Cross-Origin-Resource-Policy follows the content type (corpFor). */
  corp?: boolean;
  /** The site stores pages at the edge: an HTML page carrying a nonce gets a fresh one per reader. */
  renew?: boolean;
  /** Paths that also get `X-Robots-Tag: noindex`, covering resource routes and redirects where no meta tag can go. */
  noindex?: (pathname: string) => boolean;
};

export type PageSecurity = {
  /** The response with the site's headers; `nonce` is the one the page was rendered with, when the caller kept it. */
  withSecurityHeaders(response: Response, request: Request, nonce?: string): Response;
  /** The request's nonce, issued on first ask, for the render to put on its scripts. */
  nonceFor(request: Request): string;
};

/** The Worker glue for a site's security headers, built once at module scope. */
export function pageSecurity(options: PageSecurityOptions): PageSecurity;
