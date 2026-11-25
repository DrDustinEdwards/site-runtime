/**
 * @template [Env=unknown]
 * @param {PageSecurityOptions<Env>} options
 */
export function pageSecurity<Env = unknown>({ set, policy, staged, reportPath, group, corp, renew, noindex, reportOrigin, unpoliced, }: PageSecurityOptions<Env>): {
    withSecurityHeaders: (response: Response, request: Request, given?: string, env?: Env) => Response;
    nonceFor: (request: Request) => string;
};
/**
 * What a site's policy function is told about the response it is building the policy for.
 */
export type PolicyContext<Env = unknown> = {
    /**
     * The nonce this page is rendered with (none for a response that is not a page).
     */
    nonce: string | undefined;
    request: Request;
    url: URL;
    /**
     * True when the Report-Only companion is being built, so a directive a browser ignores there can be left out.
     */
    staged: boolean;
    /**
     * The bindings passed as withSecurityHeaders' fourth argument.
     */
    env: Env | undefined;
};
export type PageSecurityOptions<Env = unknown> = {
    /**
     * The site's header set: `buildSecurityHeaders({ site })`, plus any header of its own.
     */
    set: Readonly<Record<string, string>>;
    /**
     * The site's Content-Security-Policy for one response. report-uri and report-to are filled in when not named. A string is the finished policy, sent as it is with no Report-Only companion (for answers that load nothing).
     */
    policy: (context: PolicyContext<Env>) => SitePolicy | string;
    /**
     * What the Report-Only companion adds (the registry entry's staging, e.g. `{ trustedTypes: true, denyUnlisted: true }`), or false for none.
     */
    staged: Partial<SitePolicy> | false;
    /**
     * Default CSP_REPORT_PATH.
     */
    reportPath?: string | undefined;
    /**
     * Default CSP_REPORT_GROUP.
     */
    group?: string | undefined;
    /**
     * Cross-Origin-Resource-Policy follows the content type (corpFor).
     */
    corp?: boolean | undefined;
    /**
     * The site stores pages at the edge: an HTML page carrying a nonce other than this request's gets a fresh one per reader.
     */
    renew?: boolean | undefined;
    /**
     * True for a Content-Type the site sends no Content-Security-Policy or companion on (feeds, sitemaps, JSON, PDF); the rest of the set still goes on.
     */
    unpoliced?: ((contentType: string | null) => boolean) | undefined;
    /**
     * Paths that also get `X-Robots-Tag: noindex`, covering resource routes and redirects where no meta tag can go.
     */
    noindex?: ((pathname: string) => boolean) | undefined;
    /**
     * The origin of a report sink that is not the request's own (an AI door outside Access); reports and Reporting-Endpoints go there.
     */
    reportOrigin?: ((context: {
        request: Request;
        url: URL;
        env: Env | undefined;
    }) => string | undefined) | undefined;
};
export type PageSecurity<Env = unknown> = {
    withSecurityHeaders(response: Response, request: Request, nonce?: string, env?: Env): Response;
    nonceFor(request: Request): string;
};
import type { SitePolicy } from "./csp.mjs";
