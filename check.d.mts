import type { SiteEntry } from "./sites.mjs";

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
 * `inlineStyles`: `'unsafe-inline'` accepted on style-src (C11). `strictDynamic` (C3), `trustedTypes` (C7), `denyUnlisted`
 * (C9) and `integrityPolicy` (S2) are graded only when declared. `upload`: the response is an uploaded file (A3).
 */
export type CheckOptions = {
    site?: string | SiteEntry;
    standard?: Readonly<Record<string, string>>;
    csp?: boolean;
    cloudflareWebAnalytics?: boolean;
    inlineScripts?: "unsafe-inline";
    formTargets?: readonly string[];
    framedBySameOrigin?: boolean;
    baseUriSelf?: boolean;
    inlineStyles?: boolean;
    strictDynamic?: boolean;
    trustedTypes?: true | "report-only";
    denyUnlisted?: boolean;
    integrityPolicy?: "enforce" | "report-only";
    upload?: boolean;
};
/** Every check on one response, passing or failing, each with the checklist item it proves. */
export function checkSecurityHeaders(headers: Headers, options?: CheckOptions): CheckResult[];
/** The failed results, warnings and notices left out. */
export function failures(results: CheckResult[]): CheckResult[];
/**
 * security.txt against RFC 9116: 200 and `text/plain; charset=utf-8` (D1), Contact and one Expires under a year out
 * (D2), a warning 30 days before it (D4), Canonical and the OpenPGP signature (D3). `origin`: the site's own, when the
 * file is served from elsewhere.
 */
export function checkSecurityTxt(
    response: { url: string; origin?: string; status: number; headers: Headers; body: string; now?: number },
    options?: { site?: string | SiteEntry },
): CheckResult[];
/** The deviation that covers a failed result, the family's (FAMILY_DEVIATIONS) or the entry's, or undefined. */
export function declined(entry: SiteEntry | undefined, id: string, name?: string): { reason: string; family: boolean } | undefined;
/**
 * `id`: the checklist item (T2, H1, C4, ...). `warn`: advice, or an item the site declared a deviation for. `notice`: an
 * item no family site can meet (FAMILY_DEVIATIONS). Neither fails anything.
 */
export type CheckResult = {
    id: string;
    name: string;
    pass: boolean;
    detail: string;
    warn?: boolean;
    notice?: boolean;
};
