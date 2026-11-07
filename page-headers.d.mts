import type { SitePolicy } from "./csp.mjs";

/** What a site's policy function is told about the response it is building the policy for. */
export type PolicyContext<Env = unknown> = {
  /** The nonce this page is rendered with (none for a response that is not a page). */
  nonce: string | undefined;
  request: Request;
  url: URL;
  /** True when the Report-Only companion is being built, so a directive a browser ignores there can be left out. */
  staged: boolean;
  /** The bindings passed as withSecurityHeaders' fourth argument. */
  env: Env | undefined;
};

export type PageSecurityOptions<Env = unknown> = {
  /** The site's header set: `buildSecurityHeaders({ site })`, plus any header of its own. */
  set: Readonly<Record<string, string>>;
  /**
   * The site's Content-Security-Policy for one response. report-uri and report-to are filled in when not named. A string
   * is the finished policy, sent as it is with no Report-Only companion (for answers that load nothing).
   */
  policy: (context: PolicyContext<Env>) => SitePolicy | string;
  /** What the Report-Only companion adds (the registry entry's staging, e.g. `{ trustedTypes: true, denyUnlisted: true }`), or false for none. */
  staged: Partial<SitePolicy> | false;
  /** Default CSP_REPORT_PATH. */
  reportPath?: string;
  /** Default CSP_REPORT_GROUP. */
  group?: string;
  /** Cross-Origin-Resource-Policy follows the content type (corpFor). */
  corp?: boolean;
  /** The site stores pages at the edge: an HTML page carrying a nonce other than this request's gets a fresh one per reader. */
  renew?: boolean;
  /** True for a Content-Type the site sends no Content-Security-Policy or companion on (feeds, sitemaps, JSON, PDF); the rest of the set still goes on. */
  unpoliced?: (contentType: string | null) => boolean;
  /** Paths that also get `X-Robots-Tag: noindex`, covering resource routes and redirects where no meta tag can go. */
  noindex?: (pathname: string) => boolean;
  /** The origin of a report sink that is not the request's own (an AI door outside Access); reports and Reporting-Endpoints go there. */
  reportOrigin?: (context: {
    request: Request;
    url: URL;
    env: Env | undefined;
  }) => string | undefined;
};

export type PageSecurity<Env = unknown> = {
  /** The response with the site's headers; `nonce` is the one the page was rendered with, when the caller kept it. */
  withSecurityHeaders(response: Response, request: Request, nonce?: string, env?: Env): Response;
  /** The request's nonce, issued on first ask, for the render to put on its scripts. */
  nonceFor(request: Request): string;
};

/** The Worker glue for a site's security headers, built once at module scope. */
export function pageSecurity<Env = unknown>(options: PageSecurityOptions<Env>): PageSecurity<Env>;
