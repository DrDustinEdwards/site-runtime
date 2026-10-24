/**
 * @param {string} policy
 * @returns {Map<string, string[]>} directive name to its sources, lower-cased names
 */
export function parsePolicy(policy: string): Map<string, string[]>;
/**
 * @param {Headers} headers a real response's headers
 * @param {{ standard?: Readonly<Record<string, string>>, csp?: boolean, cloudflareWebAnalytics?: boolean, inlineScripts?: "unsafe-inline" }} [options]
 *   `standard`: the floor (default STANDARD_SECURITY_HEADERS; a site passes the set it declared). `csp`: grade the
 *   policy too; false for a response that carries none by design, such as a feed or an image.
 *   `cloudflareWebAnalytics`: the site is Cloudflare-proxied with Web Analytics on, so the policy must let the injected
 *   beacon run (its script path prefix) and report (connect-src with the site itself).
 *   `inlineScripts`: the site built its policy with the same opt-in (buildContentSecurityPolicy), so `'unsafe-inline'`
 *   is accepted on script-src alone; script-src-elem, script-src-attr and worker-src are still refused it.
 * @returns {CheckResult[]}
 */
export function checkSecurityHeaders(headers: Headers, { standard, csp, cloudflareWebAnalytics, inlineScripts }?: {
    standard?: Readonly<Record<string, string>>;
    csp?: boolean;
    cloudflareWebAnalytics?: boolean;
    inlineScripts?: "unsafe-inline";
}): CheckResult[];
export function failures(results: CheckResult[]): CheckResult[];
export type CheckResult = {
    name: string;
    pass: boolean;
    detail: string;
};
