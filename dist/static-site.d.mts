/**
 * A site's headers from its registry entry (./sites), for its static files and the Worker in front of them: `set`, what
 * every response carries (buildSecurityHeaders({ site }), then `headers`, what the site adds on top, such as Prelum's
 * TDMRep header), and `file`, the `_headers` text (headersFile with charset: true, then the entry's `assets.paths`). A
 * static site whose entry has `assets.policy` serves every page under that one policy, built with its policy opt-ins
 * (denyUnlisted true, cloudflareWebAnalytics, framedBySameOrigin, embeds...) and reporting to /csp-report on its own origin or
 * `assets.reportOrigin`: it is in `set` with its Reporting-Endpoints, and in `file` as a `/*` rule of its own, since
 * headersFile keeps a policy off the set's block. What the entry stages ("report-only" trustedTypes or denyUnlisted)
 * goes in a Report-Only policy beside it (buildStagedPolicy). The site-runtime-headers bin writes `file`.
 * @param {import("./sites.mjs").ServedSiteEntry} entry
 * @param {{ headers?: Readonly<Record<string, string>> }} [options]
 * @returns {{ set: Record<string, string>, file: string }}
 */
export function staticHeaders(entry: import("./sites.mjs").ServedSiteEntry, { headers }?: {
    headers?: Readonly<Record<string, string>>;
}): {
    set: Record<string, string>;
    file: string;
};
/**
 * The fetch handler for a static site. `site` is its registry entry, whose set (staticHeaders) its `_headers` file was
 * written from, with `headers` added to it; without `site`, `headers` is the whole set. `preload` is the `Link` header
 * value from `preloads(...).header`.
 * @param {{
 *   site?: import("./sites.mjs").ServedSiteEntry,
 *   headers?: Readonly<Record<string, string>>,
 *   preload?: string,
 *   reportPath?: string | null,
 *   prefetch?: Parameters<typeof speculationRulesResponse>[0] | false,
 *   canonical?: Parameters<typeof canonicalRedirect>[1] | false,
 *   notFound?: string,
 *   siteName?: string,
 *   health?: string | false,
 * }} [options]
 */
export function staticSite({ site, headers: extra, preload, reportPath, prefetch, canonical, notFound, siteName, health, }?: {
    site?: import("./sites.mjs").ServedSiteEntry;
    headers?: Readonly<Record<string, string>>;
    preload?: string;
    reportPath?: string | null;
    prefetch?: Parameters<typeof speculationRulesResponse>[0] | false;
    canonical?: Parameters<typeof canonicalRedirect>[1] | false;
    notFound?: string;
    siteName?: string;
    health?: string | false;
}): {
    /** @param {Request} request @param {StaticSiteEnv} env */
    fetch(request: Request, env: StaticSiteEnv): Promise<Response>;
};
export type StaticSiteOptions = {
    /**
     * The site's registry entry, whose set (staticHeaders) its `_headers` file was written from.
     */
    site?: {
        id: string;
        headers?: {
            readonly [x: string]: {
                value: string | null;
            };
        } | undefined;
        origin: string;
        aliases?: readonly string[] | undefined;
        oldSite?: {
            value: string;
        } | undefined;
        optIns?: {
            cloudflareWebAnalytics?: {
                value: boolean | "manual";
            } | undefined;
            inlineScripts?: {
                value: "unsafe-inline";
            } | undefined;
            formTargets?: {
                value: readonly string[];
            } | undefined;
            framedBySameOrigin?: {
                value: boolean;
            } | undefined;
            baseUriSelf?: {
                value: boolean;
            } | undefined;
            passkey?: {
                value: boolean;
            } | undefined;
            inlineStyles?: {
                value: boolean;
            } | undefined;
            strictDynamic?: {
                value: boolean;
            } | undefined;
            trustedTypes?: {
                value: true | "report-only";
            } | undefined;
            denyUnlisted?: {
                value: boolean | "report-only";
            } | undefined;
            integrityPolicy?: {
                value: "enforce" | "report-only";
            } | undefined;
            coep?: {
                value: "credentialless" | "require-corp";
                reportOnly?: boolean | undefined;
            } | undefined;
            uploads?: {
                value: string;
            } | undefined;
            embeds?: {
                value: boolean;
            } | undefined;
        } | undefined;
        assets?: {
            skipWorker?: {
                value: readonly string[];
            } | undefined;
            policy?: {
                sources?: {
                    script?: readonly string[] | undefined;
                    style?: readonly string[] | undefined;
                    img?: readonly string[] | undefined;
                    font?: readonly string[] | undefined;
                    connect?: readonly string[] | undefined;
                    frame?: readonly string[] | undefined;
                    media?: readonly string[] | undefined;
                } | undefined;
                scriptHashes?: readonly string[] | undefined;
                styleHashes?: readonly string[] | undefined;
                nonceStyles?: boolean | undefined;
                inlineScripts?: "unsafe-inline" | undefined;
                strictDynamic?: boolean | undefined;
                styleAttributesInline?: boolean | undefined;
                cloudflareWebAnalytics?: boolean | "manual" | undefined;
                reportUri?: string | undefined;
                reportTo?: string | undefined;
                framedBySameOrigin?: boolean | undefined;
                embeds?: boolean | undefined;
                baseUriSelf?: boolean | undefined;
                denyUnlisted?: boolean | undefined;
                noForms?: boolean | undefined;
                formTargets?: readonly string[] | undefined;
                trustedTypes?: (true | readonly string[]) | undefined;
                extraDirectives?: readonly string[] | undefined;
            } | undefined;
            reportOrigin?: string | undefined;
            paths?: {
                readonly [x: string]: {
                    readonly [x: string]: string;
                };
            } | undefined;
        } | undefined;
        signIn?: {
            admin?: readonly string[] | undefined;
            mcp?: readonly string[] | undefined;
        } | undefined;
    } | undefined;
    /**
     * With `site`, what the site adds to that set; without it, the whole set.
     */
    headers?: Readonly<Record<string, string>> | undefined;
    /**
     * The `Link` header value, `preloads(...).header`, sent on a 200 page.
     */
    preload?: string | undefined;
    /**
     * Where Content-Security-Policy reports are received; null for none. Default /csp-report.
     */
    reportPath?: string | null | undefined;
    /**
     * The prefetch rules' options, or false to serve none and send no Speculation-Rules header.
     */
    prefetch?: Parameters<typeof speculationRules>[0] | false;
    /**
     * canonicalRedirect's options, or false to redirect nothing (a site whose files end in a slash).
     */
    canonical?: Parameters<typeof canonicalRedirect>[1] | false;
    /**
     * The 404 page's path. Default /404.
     */
    notFound?: string | undefined;
    /**
     * The site's name on the maintenance page.
     */
    siteName?: string | undefined;
    /**
     * Where the /health response (./health, with `sha` from DEPLOY_SHA) is served, or false for none. Default /health.
     */
    health?: string | false | undefined;
};
export type StaticSiteEnv = {
    ASSETS: {
        fetch(request: Request): Promise<Response>;
    };
    CSP_REPORT_RATE_LIMIT?: {
        limit(options: {
            key: string;
        }): Promise<{
            success: boolean;
        }>;
    };
    DEPLOY_SHA?: string;
    MAINTENANCE?: string;
};
import { speculationRulesResponse } from "./prefetch.mjs";
import { canonicalRedirect } from "./url.mjs";
import type { speculationRules } from "./prefetch.mjs";
