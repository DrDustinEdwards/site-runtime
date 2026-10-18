/**
 * Content-Security-Policy helpers: a per-request nonce, a hash source for an inline script, and the policy a site's
 * own list of what it loads builds.
 *
 * - generateNonce is foxhound's (app/lib/http/security-headers.ts): 16 random bytes, base64. Call it
 *   once per request and give the same value to the rendered <script nonce> and to the policy.
 * - scriptHash is dustinedwards.info's (workers/csp.mjs): Web Crypto rather than node:crypto, so a
 *   Worker and a Node gate run one function.
 * - buildContentSecurityPolicy takes the hosts a site loads, per kind, plus its nonce or hashes, and returns the
 *   header (enforced, or Report-Only so a repo can ship the policy before it blocks anything). It is the one place
 *   the policy's fixed parts (object-src, base-uri, frame-ancestors, form-action, the report sink) and the
 *   Cloudflare Web Analytics beacon are written.
 * - buildPolicy is the plain join, for a policy that is not a page's (a sandboxed media route).
 *
 * Which to use, nonce or hash: a response that is never shared-cached may carry a nonce. A response that is
 * edge-cached must not, since every reader would share one nonce for the cache lifetime; trust its inline scripts
 * by hash instead.
 */
/** @returns {string} a fresh nonce, 24 base64 characters */
export function generateNonce(): string;
/**
 * @param {string} text an inline script's exact text, as the page renders it
 * @returns {Promise<string>} `sha256-<base64>`, without the quotes the policy puts round it
 */
export function scriptHash(text: string): Promise<string>;
/**
 * The policy string from directives in the order given: `["default-src 'self'", "object-src 'none'"]`
 * becomes `default-src 'self'; object-src 'none'`. Order is kept, so a gate comparing strings sees
 * exactly what the site wrote.
 *
 * @param {readonly string[]} directives
 * @returns {string}
 */
export function buildPolicy(directives: readonly string[]): string;
/**
 * @typedef {{
 *   script?: readonly string[],
 *   style?: readonly string[],
 *   img?: readonly string[],
 *   font?: readonly string[],
 *   connect?: readonly string[],
 *   frame?: readonly string[],
 *   media?: readonly string[],
 * }} CspSources
 *   The hosts (or schemes, such as `data:`) a site loads, per kind, beyond 'self'. A kind with nothing extra is
 *   omitted. A source is written as a policy writes it: `https://cdn.example.com`, `data:`.
 *
 * @typedef {{
 *   sources?: CspSources,
 *   scriptHashes?: readonly string[],
 *   styleHashes?: readonly string[],
 *   nonce?: string,
 *   styleAttributesInline?: boolean,
 *   cloudflareWebAnalytics?: boolean,
 *   reportUri?: string,
 *   reportTo?: string,
 *   reportOnly?: boolean,
 *   extraDirectives?: readonly string[],
 * }} SitePolicy
 *   `scriptHashes` / `styleHashes`: `sha256-...` values (scriptHash), for responses that may not carry a nonce.
 *   `nonce`: this request's nonce, for a response that is never shared-cached; it goes on script-src and style-src.
 *   `styleAttributesInline`: `style-src-attr 'unsafe-inline'`, for pages that emit style attributes, which a nonce
 *   cannot cover; the one inline allowance offered, scoped to attributes, which run no code.
 *   `reportUri` / `reportTo`: where violations go. A policy with no sink hides the page it breaks, so one is required.
 */
/**
 * The Content-Security-Policy header a site sends, from what it loads. The fixed parts are the same everywhere
 * (`default-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, `frame-ancestors 'none'`);
 * scripts are 'self', the site's hashes or nonce, its listed hosts and, when asked, the Cloudflare beacon. A script
 * source that is `*` (or any host-source whose host is `*`), a bare scheme, or 'unsafe-inline' or 'unsafe-eval' in any
 * case is refused here, so a site cannot list its way to a policy the check would fail.
 *
 * @param {SitePolicy} site
 * @returns {{ name: "Content-Security-Policy" | "Content-Security-Policy-Report-Only", value: string }}
 */
export function buildContentSecurityPolicy(site: SitePolicy): {
    name: "Content-Security-Policy" | "Content-Security-Policy-Report-Only";
    value: string;
};
/**
 * Cloudflare Web Analytics, automatic setup, written once for every site on a Cloudflare-proxied hostname. The edge
 * injects the beacon from a VERSIONED path (/beacon.min.js/v31..., measured in a browser), which the bare file URL
 * does not match; a source ending in "/" is a path prefix, so the second entry covers that one directory and nothing
 * else on the host. It reports to the site's own /cdn-cgi/rum, so connect-src needs 'self' on such a site (the
 * builder always includes it). The file is named, not hashed: its `integrity` changes whenever Cloudflare ships a
 * new beacon, and a pinned hash would block it within weeks.
 */
export const CLOUDFLARE_WEB_ANALYTICS: Readonly<{
    script: readonly string[];
}>;
/**
 * The hosts (or schemes, such as `data:`) a site loads, per kind, beyond 'self'. A kind with nothing extra is
 * omitted. A source is written as a policy writes it: `https://cdn.example.com`, `data:`.
 */
export type CspSources = {
    script?: readonly string[];
    style?: readonly string[];
    img?: readonly string[];
    font?: readonly string[];
    connect?: readonly string[];
    frame?: readonly string[];
    media?: readonly string[];
};
/**
 * `scriptHashes` / `styleHashes`: `sha256-...` values (scriptHash), for responses that may not carry a nonce.
 * `nonce`: this request's nonce, for a response that is never shared-cached; it goes on script-src and style-src.
 * `styleAttributesInline`: `style-src-attr 'unsafe-inline'`, for pages that emit style attributes, which a nonce
 * cannot cover; the one inline allowance offered, scoped to attributes, which run no code.
 * `reportUri` / `reportTo`: where violations go. A policy with no sink hides the page it breaks, so one is required.
 */
export type SitePolicy = {
    sources?: CspSources;
    scriptHashes?: readonly string[];
    styleHashes?: readonly string[];
    nonce?: string;
    styleAttributesInline?: boolean;
    cloudflareWebAnalytics?: boolean;
    reportUri?: string;
    reportTo?: string;
    reportOnly?: boolean;
    extraDirectives?: readonly string[];
};
