/**
 * @param {string} policy
 * @returns {Map<string, string[]>} directive name to its sources, lower-cased names
 */
export function parsePolicy(policy: string): Map<string, string[]>;
/**
 * `site`: an id in the registry (./sites); the floor and the opt-ins come from its entry. `standard`: the floor without
 * one (default STANDARD_SECURITY_HEADERS). `csp`: grade the policy too; false for a response that carries none by design.
 * `cloudflareWebAnalytics`: the policy must let the injected beacon run and report. `inlineScripts`: `'unsafe-inline'` is
 * accepted on script-src alone. `formTargets`: off-site form targets accepted after 'self'. `framedBySameOrigin` /
 * `baseUriSelf`: true accepts 'self' beside 'none' on frame-ancestors and base-uri, false 'none' alone; left out, either.
 */
export type CheckOptions = {
    site?: string;
    standard?: Readonly<Record<string, string>>;
    csp?: boolean;
    cloudflareWebAnalytics?: boolean;
    inlineScripts?: "unsafe-inline";
    formTargets?: readonly string[];
    framedBySameOrigin?: boolean;
    baseUriSelf?: boolean;
};
/** Every check on one response, passing or failing, each with the checklist item it proves. */
export function checkSecurityHeaders(headers: Headers, options?: CheckOptions): CheckResult[];
/** The failed results, warnings left out. */
export function failures(results: CheckResult[]): CheckResult[];
/** `id`: the checklist item (T2, H1, C4, ...). `warn`: advice that fails nothing. */
export type CheckResult = {
    id: string;
    name: string;
    pass: boolean;
    detail: string;
    warn?: boolean;
};
