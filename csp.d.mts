/**
 * Content-Security-Policy helpers: a per-request nonce, a hash source for an inline script, and the policy a site's
 * own list of what it loads builds.
 *
 * - generateNonce: 16 random bytes, base64. Call it once per request and give the same value to the rendered
 *   <script nonce> and to the policy.
 * - scriptHash: Web Crypto rather than node:crypto, so a Worker and a Node gate run one function.
 * - buildContentSecurityPolicy takes the hosts a site loads, per kind, plus its nonce or hashes, and returns the
 *   header (enforced, or Report-Only so a repo can ship the policy before it blocks anything). It is the one place
 *   the policy's fixed parts (object-src, base-uri, frame-ancestors, form-action, the report sink) and the
 *   Cloudflare Web Analytics beacon are written.
 * - buildPolicy is the plain join, for a policy that is not a page's (a sandboxed media route).
 *
 * - reportingEndpoints is the Reporting-Endpoints header that names a policy's report-to group.
 *
 * Which to use, nonce or hash: a response that is never shared-cached may carry a nonce. A response that is
 * edge-cached must not, since every reader would share one nonce for the cache lifetime; trust its inline scripts
 * by hash instead. Only when neither can work (an edge-cached page that streams inline scripts whose text changes
 * per page, as React Router's hydration data does) does a site opt into `inlineScripts: "unsafe-inline"`.
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
 *   framedBySameOrigin?: boolean,
 *   extraDirectives?: readonly string[],
 * }} SitePolicy
 *   `scriptHashes` / `styleHashes`: `sha256-...` values (scriptHash), for responses that may not carry a nonce.
 *   `nonce`: this request's nonce, for a response that is never shared-cached; it goes on script-src and style-src.
 *   `styleAttributesInline`: `style-src-attr 'unsafe-inline'`, for pages that emit style attributes, which a nonce
 *   cannot cover; the one inline allowance offered, scoped to attributes, which run no code.
 *   `reportUri` / `reportTo`: where violations go. A policy with no sink hides the page it breaks, so one is required.
 *   `framedBySameOrigin`: `frame-ancestors 'self'` in place of 'none', for a site that shows its own pages in frames
 *   (a design system's live specimens). No other origin can be allowed to frame a site.
 */
/**
 * The Content-Security-Policy header a site sends, from what it loads. The fixed parts are the same everywhere
 * (`default-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, `frame-ancestors 'none'`, or
 * 'self' when the site frames its own pages);
 * scripts are 'self', the site's hashes or nonce, its listed hosts and, when asked, the Cloudflare beacon. A script
 * source that is `*` (or any host-source whose host is `*`), a bare scheme, or 'unsafe-inline' or 'unsafe-eval' in any
 * case is refused here, so a site cannot list its way to a policy the check would fail; 'unsafe-inline' comes only
 * from the named opt-in `inlineScripts`, which the check accepts when the site declares the same.
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
 * `nonceStyles: false`: the nonce on script-src only, for a page whose styles must run as 'unsafe-inline' (listed in
 * `sources.style`), which a nonce on style-src would switch off; styles run no code, scripts keep the nonce.
 * `inlineScripts: "unsafe-inline"`: `'unsafe-inline'` on script-src, the explicit opt-in for a page whose inline
 * scripts neither a nonce nor hashes can cover (an edge-cached page that streams inline hydration scripts). A nonce
 * is preferred, then hashes; this is the last resort, and it is refused beside a nonce or hashes, since a browser
 * ignores 'unsafe-inline' when either is present and the page's inline scripts would stop running.
 * `strictDynamic`: `'strict-dynamic'` on script-src, so a script the nonce or a hash trusts may load others (a
 * bundler's route chunks). A browser then ignores 'self' and host sources, so it needs a nonce or script hashes
 * (without one nothing runs) and refuses the Cloudflare beacon, which the edge injects with no nonce. It is the only
 * way to write the keyword: as a raw script source it is refused.
 * `styleAttributesInline`: `style-src-attr 'unsafe-inline'`, for pages that emit style attributes, which a nonce
 * cannot cover; the one inline allowance offered, scoped to attributes, which run no code.
 * `reportUri` / `reportTo`: where violations go. A policy with no sink hides the page it breaks, so one is required.
 * `framedBySameOrigin`: `frame-ancestors 'self'` in place of 'none', for a site that shows its own pages in frames.
 * `denyUnlisted`: `default-src 'none'` in place of 'self', so a kind the policy does not name (media, frames,
 * workers, the manifest) is refused rather than allowed from the site; for a static site that wants nothing more.
 * `noForms`: `form-action 'none'` in place of 'self', for a site with no forms.
 * `formTargets`: https origins added to `form-action 'self'`, for a form whose POST redirects off the site (Stripe
 * Checkout or Connect OAuth). Each is a bare https origin; none goes with `noForms`. The check accepts them when the
 * site declares the same.
 * `baseUriSelf`: `base-uri 'self'` in place of 'none', for a page that writes a same-origin <base> (an EPUB reader
 * resolving a book's files); the check accepts either.
 * `trustedTypes`: `require-trusted-types-for 'script'`; a list adds `trusted-types <names>`. Report-Only first
 * (buildStagedPolicy).
 */
export type SitePolicy = {
    sources?: CspSources;
    scriptHashes?: readonly string[];
    styleHashes?: readonly string[];
    nonce?: string;
    nonceStyles?: boolean;
    inlineScripts?: "unsafe-inline";
    strictDynamic?: boolean;
    styleAttributesInline?: boolean;
    cloudflareWebAnalytics?: boolean;
    reportUri?: string;
    reportTo?: string;
    reportOnly?: boolean;
    framedBySameOrigin?: boolean;
    baseUriSelf?: boolean;
    denyUnlisted?: boolean;
    noForms?: boolean;
    formTargets?: readonly string[];
    trustedTypes?: true | readonly string[];
    extraDirectives?: readonly string[];
};
/**
 * The Reporting-Endpoints header value that defines a policy's `report-to` group: `csp-endpoint="https://example.com/csp-report"`.
 * The URL must be absolute and potentially trustworthy: https, or http on a loopback host (127.0.0.0/8, [::1], localhost or
 * a name under .localhost), so a local dev server works. A browser skips any other endpoint (Reporting API, "process
 * reporting endpoints": "If endpoint url's origin is not potentially trustworthy, then continue"; the hosts are Secure
 * Contexts, https://w3c.github.io/webappsec-secure-contexts/#is-origin-trustworthy), and the group's reports then go nowhere.
 *
 * @param group the name the policy's `reportTo` gives
 * @param url the receiver, absolute: `new URL("/csp-report", origin)`
 */
export function reportingEndpoints(group: string, url: string | URL): string;
/** A host source whose host starts with a wildcard: `https://*.example.com`. */
export const WILDCARD_HOST: RegExp;
/** The Report-Only companion for a staged rollout: the site's policy with `staged` added (Trusted Types first). */
export function buildStagedPolicy(site: SitePolicy, staged: Partial<SitePolicy>): {
    name: "Content-Security-Policy-Report-Only";
    value: string;
};
/** Integrity-Policy (or -Report-Only): `blocked-destinations=(script)`, with `endpoints=(<group>)` when given. */
export function integrityPolicy(options?: { endpoint?: string; reportOnly?: boolean }): {
    name: "Integrity-Policy" | "Integrity-Policy-Report-Only";
    value: string;
};
/**
 * A stored HTML page with a fresh nonce in its policy header and on every <script>, <style> and <link> that carried the
 * rendered one (HTMLRewriter; throws without it). Anything else comes back as it is.
 */
export function renewNonce(response: Response, nonce?: string): Response;
