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
 */
export function checkSecurityHeaders(headers: Headers, options?: CheckOptions): CheckResult[];
export { checkSecurityTxt } from "./check-security-txt.mjs";
export function failures(results: CheckResult[]): CheckResult[];
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
export type CheckedSiteEntry = import("./check-core.mjs").CheckedSiteEntry;
export { declined, parsePolicy } from "./check-core.mjs";
