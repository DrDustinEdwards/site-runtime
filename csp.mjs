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
 * Which to use, nonce or hash: a response that is never shared-cached may carry a nonce. A response that is
 * edge-cached must not, since every reader would share one nonce for the cache lifetime; trust its inline scripts
 * by hash instead.
 */

/** @returns {string} a fresh nonce, 24 base64 characters */
export function generateNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * @param {string} text an inline script's exact text, as the page renders it
 * @returns {Promise<string>} `sha256-<base64>`, without the quotes the policy puts round it
 */
export async function scriptHash(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}`;
}

/**
 * The policy string from directives in the order given: `["default-src 'self'", "object-src 'none'"]`
 * becomes `default-src 'self'; object-src 'none'`. Order is kept, so a gate comparing strings sees
 * exactly what the site wrote.
 *
 * @param {readonly string[]} directives
 * @returns {string}
 */
export function buildPolicy(directives) {
  const empty = directives.filter((d) => d.trim() === "");
  if (empty.length > 0) throw new Error("a CSP directive is empty");
  return directives.join("; ");
}

/**
 * Cloudflare Web Analytics, automatic setup, written once for every site on a Cloudflare-proxied hostname. The edge
 * injects the beacon from a VERSIONED path (/beacon.min.js/v31..., measured in a browser), which the bare file URL
 * does not match; a source ending in "/" is a path prefix, so the second entry covers that one directory and nothing
 * else on the host. It reports to the site's own /cdn-cgi/rum, so connect-src needs 'self' on such a site (the
 * builder always includes it). The file is named, not hashed: its `integrity` changes whenever Cloudflare ships a
 * new beacon, and a pinned hash would block it within weeks.
 */
export const CLOUDFLARE_WEB_ANALYTICS = Object.freeze({
  script: Object.freeze([
    "https://static.cloudflareinsights.com/beacon.min.js",
    "https://static.cloudflareinsights.com/beacon.min.js/",
  ]),
});

/** A source expression as a policy writes it: no space, no semicolon, no comma. @param {string} source */
function checkSource(source) {
  if (typeof source !== "string" || source === "" || /[\s;,]/.test(source)) throw new Error(`${JSON.stringify(source)} is not a CSP source`);
  return source;
}

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
 * case is refused here, so a site cannot list its way to a policy the check would fail.
 *
 * @param {SitePolicy} site
 * @returns {{ name: "Content-Security-Policy" | "Content-Security-Policy-Report-Only", value: string }}
 */
export function buildContentSecurityPolicy(site) {
  const { sources = {}, scriptHashes = [], styleHashes = [], nonce, styleAttributesInline = false, cloudflareWebAnalytics = false, reportUri, reportTo, reportOnly = false, framedBySameOrigin = false, extraDirectives = [] } = site;
  if (!reportUri && !reportTo) throw new Error("a policy needs a report sink (reportUri or reportTo)");
  if (nonce !== undefined && !/^[A-Za-z0-9+/_-]{16,}={0,2}$/.test(nonce)) throw new Error("the nonce is not a base64 value of at least 16 characters");
  const hashSource = (/** @type {string} */ h) => {
    if (!/^sha(256|384|512)-[A-Za-z0-9+/_-]+={0,2}$/.test(h)) throw new Error(`${JSON.stringify(h)} is not a hash source`);
    return `'${h}'`;
  };
  const list = (/** @type {readonly string[] | undefined} */ hosts) => (hosts ?? []).map(checkSource);

  const scriptHosts = [...list(sources.script), ...(cloudflareWebAnalytics ? CLOUDFLARE_WEB_ANALYTICS.script : [])];
  for (const host of scriptHosts) {
    // A host of `*` matches every host whatever the scheme, port or path; keywords match in any case in a browser.
    if (/^([a-z][a-z0-9+.-]*:\/\/)?\*(:(\d+|\*))?(\/.*)?$/i.test(host) || /^(https?|data|blob):$/i.test(host) || /^'unsafe-(inline|eval)'$/i.test(host)) {
      throw new Error(`${host} is not an acceptable script source: name the host`);
    }
  }
  // An extra directive may add a kind (frame-src, worker-src, upgrade-insecure-requests), never restate one of the fixed
  // ones, and never reopen scripts through script-src-elem or script-src-attr.
  const written = new Set(["default-src", "script-src", "script-src-elem", "script-src-attr", "object-src", "base-uri", "form-action", "frame-ancestors", "report-uri", "report-to"]);
  for (const extra of extraDirectives) {
    const [name = "", ...values] = extra.trim().split(/\s+/);
    if (written.has(name.toLowerCase())) throw new Error(`${name} is written by the builder; pass its sources instead of an extra directive`);
    if (name.toLowerCase() === "worker-src" && values.some((v) => /^([a-z][a-z0-9+.-]*:\/\/)?\*/i.test(v) || /^(https?|data):$/i.test(v) || /^'unsafe-(inline|eval)'$/i.test(v))) {
      throw new Error(`${extra} is not an acceptable worker source: name the host`);
    }
  }
  const nonceSource = nonce === undefined ? [] : [`'nonce-${nonce}'`];
  const directives = [
    "default-src 'self'",
    `script-src ${[...nonceSource, ...scriptHashes.map(hashSource), "'self'", ...scriptHosts].join(" ")}`,
    `style-src ${["'self'", ...nonceSource, ...styleHashes.map(hashSource), ...list(sources.style)].join(" ")}`,
    ...(styleAttributesInline ? ["style-src-attr 'unsafe-inline'"] : []),
    `font-src ${["'self'", ...list(sources.font)].join(" ")}`,
    `img-src ${["'self'", ...list(sources.img)].join(" ")}`,
    ...((sources.media ?? []).length > 0 ? [`media-src ${["'self'", ...list(sources.media)].join(" ")}`] : []),
    // 'self' is always present: the Cloudflare beacon reports to /cdn-cgi/rum on the site's own origin.
    `connect-src ${["'self'", ...list(sources.connect)].join(" ")}`,
    ...((sources.frame ?? []).length > 0 ? [`frame-src ${["'self'", ...list(sources.frame)].join(" ")}`] : []),
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    `frame-ancestors ${framedBySameOrigin ? "'self'" : "'none'"}`,
    ...extraDirectives,
    ...(reportUri ? [`report-uri ${checkSource(reportUri)}`] : []),
    ...(reportTo ? [`report-to ${checkSource(reportTo)}`] : []),
  ];
  return { name: reportOnly ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy", value: buildPolicy(directives) };
}
