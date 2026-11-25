/** @typedef {import("./csp.mjs").SitePolicy} SitePolicy */
/**
 * The Reporting-Endpoints header value that defines a policy's `report-to` group: `csp-endpoint="https://example.com/csp-report"`.
 * The URL must be absolute and potentially trustworthy: https, or http on a loopback host (127.0.0.0/8, [::1], localhost or
 * a name under .localhost), so a local dev server works. A browser skips any other endpoint (Reporting API, "process
 * reporting endpoints": "If endpoint url's origin is not potentially trustworthy, then continue"; the hosts are Secure
 * Contexts, https://w3c.github.io/webappsec-secure-contexts/#is-origin-trustworthy), and the group's reports then go nowhere.
 *
 * @param {string} group the name the policy's `reportTo` gives
 * @param {string | URL} url the receiver, absolute: `new URL("/csp-report", origin)`
 */
export function reportingEndpoints(group: string, url: string | URL): string;
/**
 * The Report-Only companion for a staged rollout: the site's own policy with `staged` added (Trusted Types first:
 * `{ trustedTypes: ["default"] }`), sent beside the enforced one, so the reports show what the stricter policy would
 * block before it blocks anything. When they show nothing, move `staged` into the enforced policy and drop this one.
 * @param {SitePolicy} site the options the enforced policy is built from
 * @param {Partial<SitePolicy>} staged what the next policy adds
 * @returns {{ name: "Content-Security-Policy-Report-Only", value: string }}
 */
export function buildStagedPolicy(site: SitePolicy, staged: Partial<SitePolicy>): {
    name: "Content-Security-Policy-Report-Only";
    value: string;
};
/**
 * The Integrity-Policy header: every script must carry integrity metadata (an `integrity` attribute), and a no-cors
 * script request is blocked (https://w3c.github.io/webappsec-subresource-integrity/#integrity-policy-section). It
 * needs build-time integrity on every bundle, dynamically imported chunks included (React Router's
 * `subResourceIntegrity: true` writes it into the import map and modulepreloads), so ship it Report-Only first.
 * `endpoint` is the Reporting-Endpoints group the reports go to (default CSP_REPORT_GROUP). buildSecurityHeaders
 * writes it from an entry's `integrityPolicy` opt-in.
 * @param {{ endpoint?: string, reportOnly?: boolean }} [options]
 * @returns {{ name: "Integrity-Policy" | "Integrity-Policy-Report-Only", value: string }}
 */
export function integrityPolicy({ endpoint, reportOnly }?: {
    endpoint?: string;
    reportOnly?: boolean;
}): {
    name: "Integrity-Policy" | "Integrity-Policy-Report-Only";
    value: string;
};
/**
 * A stored page with a fresh nonce: the nonce its policy was rendered with becomes `nonce` in the Content-Security-Policy
 * (and Report-Only) header and in every `nonce="…"` attribute that held it, so no two readers of an edge-cached page share
 * one, and an element injected without the old nonce gains none. Call it on every response the cache answers, hit or
 * miss. A response that is not HTML, or whose policy has no nonce, comes back as it is. The attribute's value is swapped
 * in the byte stream, never by re-serializing the tag (HTMLRewriter writes `<link … />` where React wrote `<link …/>`), so
 * a stored page differs from a fresh render of the same page by its nonce alone. This is the third way to trust inline
 * scripts on a cached page, beside hashes, and the one to use before `inlineScripts`.
 * @param {Response} response
 * @param {string} [nonce] the new nonce (generateNonce), when the caller needs to know it
 */
export function renewNonce(response: Response, nonce?: string): Response;
export type SitePolicy = import("./csp.mjs").SitePolicy;
