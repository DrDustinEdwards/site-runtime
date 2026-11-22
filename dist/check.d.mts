/**
 * A failed result an entry or the family declined, as the reason, or "". Only declinable results are looked up:
 * K1's cookie prefix, S2, C3, C7, C9, I3, and the family's (FAMILY_DEVIATIONS).
 * @param {CheckedSiteEntry | undefined} entry
 * @param {string} id
 * @param {string} [name] the cookie or thing the result is about, which a deviation's `value` must list when it has one
 * @returns {{ reason: string, family: boolean } | undefined}
 */
export function declined(entry: CheckedSiteEntry | undefined, id: string, name?: string): {
    reason: string;
    family: boolean;
} | undefined;
/**
 * @param {string} policy
 * @returns {Map<string, string[]>} directive name to its sources, lower-cased names
 */
export function parsePolicy(policy: string): Map<string, string[]>;
/**
 * @typedef {{
 *   site?: string | CheckedSiteEntry,
 *   standard?: Readonly<Record<string, string>>,
 *   csp?: boolean,
 *   cloudflareWebAnalytics?: boolean | "manual",
 *   inlineScripts?: "unsafe-inline",
 *   formTargets?: readonly string[],
 *   framedBySameOrigin?: boolean,
 *   baseUriSelf?: boolean,
 *   inlineStyles?: boolean,
 *   strictDynamic?: boolean,
 *   trustedTypes?: true | "report-only",
 *   denyUnlisted?: boolean | "report-only",
 *   integrityPolicy?: "enforce" | "report-only",
 *   upload?: boolean,
 * }} CheckOptions
 *   `site`: an id in the registry (./sites); the floor is the set buildSecurityHeaders({ site }) builds, and the opt-ins
 *   below come from its entry, so a site is graded against exactly what it declared. Each option may still be passed.
 *   `standard`: the floor without a registry entry (default STANDARD_SECURITY_HEADERS). `csp`: grade the policy too;
 *   false for a response that carries none by design, such as a feed or an image.
 *   `cloudflareWebAnalytics`: the site is Cloudflare-proxied with Web Analytics on, so the policy must let the injected
 *   beacon run (its script path prefix) and report (connect-src with the site itself). `"manual"`: the site is not
 *   proxied and carries the beacon tag itself, so script-src names the bare file and connect-src names
 *   https://cloudflareinsights.com, where that beacon reports.
 *   `inlineScripts`: the site built its policy with the same opt-in (buildContentSecurityPolicy), so `'unsafe-inline'`
 *   is accepted on script-src alone; script-src-elem, script-src-attr and worker-src are still refused it.
 *   `formTargets`: the off-site form targets the site passed the builder, accepted after 'self' on form-action.
 *   `framedBySameOrigin` / `baseUriSelf`: true accepts 'self' beside 'none' on frame-ancestors and base-uri; false
 *   accepts 'none' alone. Left out (and no `site`), either is accepted.
 *   `inlineStyles`: `'unsafe-inline'` is accepted on style-src (C11); style-src-attr's is always accepted, since
 *   attributes run no code. Every registry site is graded on Integrity-Policy (S2), a strict script policy (C3:
 *   'strict-dynamic' beside a nonce or hash, or no script at all), Trusted Types (C7), default-src 'none' (C9), COEP
 *   (I3) and the family's report sink (C14: /csp-report, group csp-endpoint): a page that misses one fails, unless the
 *   entry declares a deviation for it, which makes it a warning, so the registry is the whole list of what each site
 *   skips. Without an entry only what the options declare is graded. `strictDynamic`, `trustedTypes`, `denyUnlisted` ("report-only" reads the
 *   Report-Only policy, as `trustedTypes` does) and `integrityPolicy` are what a site promised: declared, the item is
 *   held to that form and no deviation can excuse it. `upload`: the response is an uploaded file, held to A3 (nosniff,
 *   and a sandboxed policy or an attachment).
 */
/**
 * @param {Headers} headers a real response's headers
 * @param {CheckOptions} [options]
 * @returns {CheckResult[]}
 */
export function checkSecurityHeaders(headers: Headers, options?: CheckOptions): CheckResult[];
/**
 * /.well-known/security.txt graded against RFC 9116: served 200 as `text/plain; charset=utf-8` (D1), one Contact and
 * exactly one Expires under a year out (D2), a warning 30 days before it (D4), and a Canonical naming the URL it is
 * served from or the site's own (D3). A signed file must carry its whole signature block; an unsigned one is the
 * family's deviation (FAMILY_DEVIATIONS.D3).
 * @param {{ url: string, origin?: string, status: number, headers: Headers, body: string, now?: number }} response
 *   `url` where it was fetched; `origin` the site's own, when it is served from elsewhere
 * @param {{ site?: string | CheckedSiteEntry }} [options]
 * @returns {CheckResult[]}
 */
export function checkSecurityTxt({ url, origin, status, headers, body, now }: {
    url: string;
    origin?: string;
    status: number;
    headers: Headers;
    body: string;
    now?: number;
}, { site }?: {
    site?: string | CheckedSiteEntry;
}): CheckResult[];
export function failures(results: CheckResult[]): CheckResult[];
/**
 * A served entry with its deviations' reasons, as the check reads it (sites-deviations.mjs).
 */
export type CheckedSiteEntry = ServedSiteEntry & {
    deviations?: Readonly<Record<string, Deviation>>;
};
/**
 * `site`: an id in the registry (./sites); the floor is the set buildSecurityHeaders({ site }) builds, and the opt-ins
 * below come from its entry, so a site is graded against exactly what it declared. Each option may still be passed.
 * `standard`: the floor without a registry entry (default STANDARD_SECURITY_HEADERS). `csp`: grade the policy too;
 * false for a response that carries none by design, such as a feed or an image.
 * `cloudflareWebAnalytics`: the site is Cloudflare-proxied with Web Analytics on, so the policy must let the injected
 * beacon run (its script path prefix) and report (connect-src with the site itself). `"manual"`: the site is not
 * proxied and carries the beacon tag itself, so script-src names the bare file and connect-src names
 * https://cloudflareinsights.com, where that beacon reports.
 * `inlineScripts`: the site built its policy with the same opt-in (buildContentSecurityPolicy), so `'unsafe-inline'`
 * is accepted on script-src alone; script-src-elem, script-src-attr and worker-src are still refused it.
 * `formTargets`: the off-site form targets the site passed the builder, accepted after 'self' on form-action.
 * `framedBySameOrigin` / `baseUriSelf`: true accepts 'self' beside 'none' on frame-ancestors and base-uri; false
 * accepts 'none' alone. Left out (and no `site`), either is accepted.
 * `inlineStyles`: `'unsafe-inline'` is accepted on style-src (C11); style-src-attr's is always accepted, since
 * attributes run no code. Every registry site is graded on Integrity-Policy (S2), a strict script policy (C3:
 * 'strict-dynamic' beside a nonce or hash, or no script at all), Trusted Types (C7), default-src 'none' (C9), COEP
 * (I3) and the family's report sink (C14: /csp-report, group csp-endpoint): a page that misses one fails, unless the
 * entry declares a deviation for it, which makes it a warning, so the registry is the whole list of what each site
 * skips. Without an entry only what the options declare is graded. `strictDynamic`, `trustedTypes`, `denyUnlisted` ("report-only" reads the
 * Report-Only policy, as `trustedTypes` does) and `integrityPolicy` are what a site promised: declared, the item is
 * held to that form and no deviation can excuse it. `upload`: the response is an uploaded file, held to A3 (nosniff,
 * and a sandboxed policy or an attachment).
 */
export type CheckOptions = {
    site?: string | CheckedSiteEntry;
    standard?: Readonly<Record<string, string>>;
    csp?: boolean;
    cloudflareWebAnalytics?: boolean | "manual";
    inlineScripts?: "unsafe-inline";
    formTargets?: readonly string[];
    framedBySameOrigin?: boolean;
    baseUriSelf?: boolean;
    inlineStyles?: boolean;
    strictDynamic?: boolean;
    trustedTypes?: true | "report-only";
    denyUnlisted?: boolean | "report-only";
    integrityPolicy?: "enforce" | "report-only";
    upload?: boolean;
};
/**
 * `warn`: advice, or an item the site declared a deviation for; `notice`: an item no family site can meet
 * (FAMILY_DEVIATIONS). Neither fails anything.
 */
export type CheckResult = {
    id: string;
    name: string;
    pass: boolean;
    detail: string;
    warn?: boolean;
    notice?: boolean;
};
import type { ServedSiteEntry } from "./sites.mjs";
import type { Deviation } from "./sites.mjs";
