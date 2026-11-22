/** @returns {string} a fresh nonce, 24 base64 characters */
export function generateNonce(): string;
/**
 * @param {string} text an inline script's exact text, as the page renders it
 * @returns {Promise<string>} `sha256-<base64>`, without the quotes the policy puts round it
 */
export function scriptHash(text: string): Promise<string>;
/**
 * The `integrity` attribute value for a file a static build writes a tag for (`<script type="module" src
 * integrity crossorigin>`, a modulepreload): `sha384-<base64>` of its exact bytes. A classic script needs
 * `crossorigin` too, since Integrity-Policy refuses a no-cors script request whatever its integrity.
 * @param {string | ArrayBuffer | ArrayBufferView} content
 * @returns {Promise<string>}
 */
export function integrityHash(content: string | ArrayBuffer | ArrayBufferView): Promise<string>;
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
 * The attributes of the manual-setup beacon tag, as Cloudflare documents it: a module script (older browsers skip it)
 * with the site token in data-cf-beacon. The token is the public site tag, not a secret. Spread onto a `<script>`.
 * @param {string} token the Web Analytics site token
 * @returns {{ type: "module", defer: true, src: string, "data-cf-beacon": string }}
 */
export function cloudflareBeaconAttributes(token: string): {
    type: "module";
    defer: true;
    src: string;
    "data-cf-beacon": string;
};
/**
 * Why a source lets in hosts nobody named, or "" when it names its hosts: `*` or any host-source whose host is `*`
 * (whatever its scheme, port or path), a wildcard subdomain (`https://*.example.com`, any of which may serve JSONP or a
 * library that runs script), or a bare network scheme (`https:`). data: and blob: name no host, so they are broad only
 * where they run as script (script-src and its -elem and -attr), and data: in worker-src and child-src, since a worker
 * from a blob: URL is one the page's own script made. The one rule the builder refuses and the check fails.
 * @param {string} source a source expression as a policy writes it
 * @param {string} [directive] the directive it is in (default script-src); give default-src as script-src when it
 *   governs scripts, that is when the policy has no script-src
 * @returns {string}
 */
export function broadSource(source: string, directive?: string): string;
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
 *   nonceStyles?: boolean,
 *   inlineScripts?: "unsafe-inline",
 *   strictDynamic?: boolean,
 *   styleAttributesInline?: boolean,
 *   cloudflareWebAnalytics?: boolean | "manual",
 *   reportUri?: string,
 *   reportTo?: string,
 *   reportOnly?: boolean,
 *   framedBySameOrigin?: boolean,
 *   embeds?: boolean,
 *   baseUriSelf?: boolean,
 *   denyUnlisted?: boolean,
 *   noForms?: boolean,
 *   formTargets?: readonly string[],
 *   trustedTypes?: true | readonly string[],
 *   extraDirectives?: readonly string[],
 * }} SitePolicy
 *   `scriptHashes` / `styleHashes`: `sha256-...` values (scriptHash), for responses that may not carry a nonce.
 *   `nonce`: this request's nonce, for a response that is never shared-cached; it goes on script-src and style-src.
 *   `nonceStyles: false`: the nonce on script-src only, for a page whose styles must run as 'unsafe-inline' (listed in
 *   `sources.style`), which a nonce on style-src would switch off; styles run no code, scripts keep the nonce.
 *   `inlineScripts: "unsafe-inline"`: `'unsafe-inline'` on script-src, the explicit opt-in for a page whose inline
 *   scripts neither a nonce nor hashes can cover (an edge-cached page that streams inline hydration scripts). A nonce
 *   is preferred, then hashes; this is the last resort, and it is refused beside a nonce or hashes, since a browser
 *   ignores 'unsafe-inline' when either is present and the page's inline scripts would stop running.
 *   `strictDynamic`: `'strict-dynamic'` on script-src, so a script the nonce or a hash trusts may load others (a
 *   bundler's route chunks). A browser then ignores 'self' and host sources, so it needs a nonce or script hashes
 *   (without one nothing runs) and refuses the Cloudflare beacon, which the edge injects with no nonce. It is the only
 *   way to write the keyword: as a raw script source it is refused.
 *   `styleAttributesInline`: `style-src-attr 'unsafe-inline'`, for pages that emit style attributes, which a nonce
 *   cannot cover; the one inline allowance offered, scoped to attributes, which run no code.
 *   `reportUri` / `reportTo`: where violations go, CSP_REPORT_PATH and CSP_REPORT_GROUP unless given (a page that
 *   reports to another host names the full URL). Both are always written: a policy with no sink hides the page it
 *   breaks, report-to reaches browsers with the Reporting API and report-uri the rest (CSP Evaluator, ASVS 3.4.7).
 *   `framedBySameOrigin`: `frame-ancestors 'self'` in place of 'none', for a site that shows its own pages in frames
 *   (a design system's live specimens). No other origin can be allowed to frame a site.
 *   `embeds`: the post players (EMBED_FRAME_SOURCES, ./embeds) added to frame-src, for a site whose posts embed them;
 *   the registry entry's `embeds` opt-in, which also hands them their features (buildSecurityHeaders).
 *   `denyUnlisted`: `default-src 'none'` in place of 'self', so a kind the policy does not name (media, frames,
 *   workers, the manifest) is refused rather than allowed from the site; for a static site that wants nothing more.
 *   `noForms`: `form-action 'none'` in place of 'self', for a site with no forms.
 *   `formTargets`: https origins added to `form-action 'self'`, for a form whose POST redirects off the site (Stripe
 *   Checkout or Connect OAuth): browsers apply form-action to every redirect hop of a native submission, so 'self'
 *   alone refuses one made before hydration or with no JS. Each is a bare https origin, never a wildcard or a path,
 *   and none goes with `noForms`. The check accepts them when the site declares the same.
 *   `baseUriSelf`: `base-uri 'self'` in place of 'none', for a page that writes a same-origin <base> (an EPUB reader
 *   resolving a book's files); the check accepts either.
 *   `trustedTypes`: `require-trusted-types-for 'script'`, so a string never reaches an injection sink (innerHTML,
 *   eval, a script's src) unless a Trusted Types policy made it; a list adds `trusted-types <names>`, the policies the
 *   page may create. Ship it Report-Only first (buildStagedPolicy), then enforce.
 */
/**
 * The Content-Security-Policy header a site sends, from what it loads. The fixed parts are the same everywhere
 * (`default-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, `frame-ancestors 'none'`, or
 * 'self' when the site frames its own pages);
 * scripts are 'self', the site's hashes or nonce, its listed hosts and, when asked, the Cloudflare beacon. A source of
 * any kind that broadSource calls broad (a wildcard host or subdomain, a bare network scheme, data: or blob: for
 * scripts) is refused here, as is 'unsafe-inline' or 'unsafe-eval' as a script source in any case, so a site cannot
 * list its way to a policy the check would fail; 'unsafe-inline' comes only from the named opt-in `inlineScripts`,
 * which the check accepts when the site declares the same.
 *
 * @param {SitePolicy} site
 * @returns {{ name: "Content-Security-Policy" | "Content-Security-Policy-Report-Only", value: string }}
 */
export function buildContentSecurityPolicy(site: SitePolicy): {
    name: "Content-Security-Policy" | "Content-Security-Policy-Report-Only";
    value: string;
};
/**
 * The Reporting-Endpoints header value that defines a policy's `report-to` group: `csp-endpoint="https://example.com/csp-report"`.
 * The URL must be absolute and potentially trustworthy: https, or http on a loopback host (127.0.0.0/8, [::1], localhost or
 * a name under .localhost), so a local dev server works. A browser skips any other endpoint (Reporting API, "process
 * reporting endpoints": "If endpoint url's origin is not potentially trustworthy, then continue"; the hosts are Secure
 * Contexts, https://w3c.github.io/webappsec-secure-contexts/#is-origin-trustworthy), and the group's reports then go nowhere.
 *
 * @param {string} group the name the policy's `reportTo` gives
 * @param {string | URL} url the receiver, absolute: `new URL("/csp-report", origin)`
 * @returns {string}
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
 * @returns {Response}
 */
export function renewNonce(response: Response, nonce?: string): Response;
/** Where every site receives its reports (./csp-report): the default report-uri, and the path the check expects. */
export const CSP_REPORT_PATH: "/csp-report";
/** The report-to group every site names: the policy's, Integrity-Policy's endpoints and COEP's report-to. */
export const CSP_REPORT_GROUP: "csp-endpoint";
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
    /**
     * Manual setup, for a site Cloudflare does not proxy (a workers.dev address): the page carries the beacon tag itself
     * (`cloudflareBeaconAttributes`) and the beacon loads from the bare file URL (the exact source below, no path prefix).
     * It reports to cloudflareinsights.com, not the site's /cdn-cgi/rum, so connect-src names that origin
     * (developers.cloudflare.com/web-analytics/faq, "What do I need to add to my Content Security Policy").
     */
    manual: Readonly<{
        script: readonly string[];
        connect: readonly string[];
    }>;
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
 * `reportUri` / `reportTo`: where violations go, CSP_REPORT_PATH and CSP_REPORT_GROUP unless given (a page that
 * reports to another host names the full URL). Both are always written: a policy with no sink hides the page it
 * breaks, report-to reaches browsers with the Reporting API and report-uri the rest (CSP Evaluator, ASVS 3.4.7).
 * `framedBySameOrigin`: `frame-ancestors 'self'` in place of 'none', for a site that shows its own pages in frames
 * (a design system's live specimens). No other origin can be allowed to frame a site.
 * `embeds`: the post players (EMBED_FRAME_SOURCES, ./embeds) added to frame-src, for a site whose posts embed them;
 * the registry entry's `embeds` opt-in, which also hands them their features (buildSecurityHeaders).
 * `denyUnlisted`: `default-src 'none'` in place of 'self', so a kind the policy does not name (media, frames,
 * workers, the manifest) is refused rather than allowed from the site; for a static site that wants nothing more.
 * `noForms`: `form-action 'none'` in place of 'self', for a site with no forms.
 * `formTargets`: https origins added to `form-action 'self'`, for a form whose POST redirects off the site (Stripe
 * Checkout or Connect OAuth): browsers apply form-action to every redirect hop of a native submission, so 'self'
 * alone refuses one made before hydration or with no JS. Each is a bare https origin, never a wildcard or a path,
 * and none goes with `noForms`. The check accepts them when the site declares the same.
 * `baseUriSelf`: `base-uri 'self'` in place of 'none', for a page that writes a same-origin <base> (an EPUB reader
 * resolving a book's files); the check accepts either.
 * `trustedTypes`: `require-trusted-types-for 'script'`, so a string never reaches an injection sink (innerHTML,
 * eval, a script's src) unless a Trusted Types policy made it; a list adds `trusted-types <names>`, the policies the
 * page may create. Ship it Report-Only first (buildStagedPolicy), then enforce.
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
    cloudflareWebAnalytics?: boolean | "manual";
    reportUri?: string;
    reportTo?: string;
    reportOnly?: boolean;
    framedBySameOrigin?: boolean;
    embeds?: boolean;
    baseUriSelf?: boolean;
    denyUnlisted?: boolean;
    noForms?: boolean;
    formTargets?: readonly string[];
    trustedTypes?: true | readonly string[];
    extraDirectives?: readonly string[];
};
