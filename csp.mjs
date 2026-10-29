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
 *   nonceStyles?: boolean,
 *   inlineScripts?: "unsafe-inline",
 *   strictDynamic?: boolean,
 *   styleAttributesInline?: boolean,
 *   cloudflareWebAnalytics?: boolean,
 *   reportUri?: string,
 *   reportTo?: string,
 *   reportOnly?: boolean,
 *   framedBySameOrigin?: boolean,
 *   baseUriSelf?: boolean,
 *   denyUnlisted?: boolean,
 *   noForms?: boolean,
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
 *   `reportUri` / `reportTo`: where violations go. A policy with no sink hides the page it breaks, so one is required.
 *   `framedBySameOrigin`: `frame-ancestors 'self'` in place of 'none', for a site that shows its own pages in frames
 *   (a design system's live specimens). No other origin can be allowed to frame a site.
 *   `denyUnlisted`: `default-src 'none'` in place of 'self', so a kind the policy does not name (media, frames,
 *   workers, the manifest) is refused rather than allowed from the site; for a static site that wants nothing more.
 *   `noForms`: `form-action 'none'` in place of 'self', for a site with no forms.
 *   `baseUriSelf`: `base-uri 'self'` in place of 'none', for a page that writes a same-origin <base> (an EPUB reader
 *   resolving a book's files); the check accepts either.
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
export function buildContentSecurityPolicy(site) {
  const { sources = {}, scriptHashes = [], styleHashes = [], nonce, nonceStyles = true, inlineScripts, strictDynamic = false, styleAttributesInline = false, cloudflareWebAnalytics = false, reportUri, reportTo, reportOnly = false, framedBySameOrigin = false, baseUriSelf = false, denyUnlisted = false, noForms = false, extraDirectives = [] } = site;
  if (!reportUri && !reportTo) throw new Error("a policy needs a report sink (reportUri or reportTo)");
  if (inlineScripts !== undefined && inlineScripts !== "unsafe-inline") throw new Error(`inlineScripts is "unsafe-inline" or left out, not ${JSON.stringify(inlineScripts)}`);
  if (inlineScripts && (nonce !== undefined || scriptHashes.length > 0)) {
    throw new Error("inlineScripts cannot go with a nonce or script hashes: a browser then ignores 'unsafe-inline'; use the nonce or hashes alone");
  }
  if (strictDynamic && nonce === undefined && scriptHashes.length === 0) {
    throw new Error("strictDynamic needs a nonce or script hashes: a browser then ignores 'self' and host sources, so no script would run");
  }
  if (strictDynamic && cloudflareWebAnalytics) {
    throw new Error("strictDynamic cannot go with cloudflareWebAnalytics: 'strict-dynamic' ignores host sources, and the edge injects the beacon with no nonce, so it would be blocked");
  }
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
    if (/^'strict-dynamic'$/i.test(host)) throw new Error("'strict-dynamic' is not a script source here: pass strictDynamic: true, which checks it has a nonce or hashes to start from");
  }
  // An extra directive may add a kind the builder leaves out (worker-src, manifest-src, upgrade-insecure-requests), never
  // one it writes: a second directive of a name is ignored by browsers without a word. Nor may it reopen scripts or
  // styles past the nonce through an -elem or -attr variant (as Astro, packages/astro/src/core/csp/config.ts).
  const written = new Set([
    "default-src", "script-src", "script-src-elem", "script-src-attr", "style-src", "style-src-elem", "style-src-attr",
    "font-src", "img-src", "media-src", "connect-src", "frame-src", "object-src", "base-uri", "form-action",
    "frame-ancestors", "report-uri", "report-to",
  ]);
  for (const extra of extraDirectives) {
    const [name = "", ...values] = extra.trim().split(/\s+/);
    if (written.has(name.toLowerCase())) throw new Error(`${name} is written by the builder; pass its sources instead of an extra directive`);
    if (name.toLowerCase() === "worker-src" && values.some((v) => /^([a-z][a-z0-9+.-]*:\/\/)?\*/i.test(v) || /^(https?|data):$/i.test(v) || /^'unsafe-(inline|eval)'$/i.test(v))) {
      throw new Error(`${extra} is not an acceptable worker source: name the host`);
    }
  }
  const nonceSource = nonce === undefined ? [] : [`'nonce-${nonce}'`];
  const directives = [
    `default-src ${denyUnlisted ? "'none'" : "'self'"}`,
    `script-src ${[...nonceSource, ...scriptHashes.map(hashSource), "'self'", ...(inlineScripts ? ["'unsafe-inline'"] : []), ...(strictDynamic ? ["'strict-dynamic'"] : []), ...scriptHosts].join(" ")}`,
    `style-src ${["'self'", ...(nonceStyles ? nonceSource : []), ...styleHashes.map(hashSource), ...list(sources.style)].join(" ")}`,
    ...(styleAttributesInline ? ["style-src-attr 'unsafe-inline'"] : []),
    `font-src ${["'self'", ...list(sources.font)].join(" ")}`,
    `img-src ${["'self'", ...list(sources.img)].join(" ")}`,
    ...((sources.media ?? []).length > 0 ? [`media-src ${["'self'", ...list(sources.media)].join(" ")}`] : []),
    // 'self' is always present: the Cloudflare beacon reports to /cdn-cgi/rum on the site's own origin.
    `connect-src ${["'self'", ...list(sources.connect)].join(" ")}`,
    ...((sources.frame ?? []).length > 0 ? [`frame-src ${["'self'", ...list(sources.frame)].join(" ")}`] : []),
    "object-src 'none'",
    `base-uri ${baseUriSelf ? "'self'" : "'none'"}`,
    `form-action ${noForms ? "'none'" : "'self'"}`,
    `frame-ancestors ${framedBySameOrigin ? "'self'" : "'none'"}`,
    ...extraDirectives,
    ...(reportUri ? [`report-uri ${checkSource(reportUri)}`] : []),
    ...(reportTo ? [`report-to ${checkSource(reportTo)}`] : []),
  ];
  return { name: reportOnly ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy", value: buildPolicy(directives) };
}

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
export function reportingEndpoints(group, url) {
  if (!/^[a-z*][a-z0-9_.*-]*$/.test(group)) throw new Error(`${JSON.stringify(group)} is not a report-to group name (lower-case letters, digits, _ - . *)`);
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${JSON.stringify(String(url))} is not an absolute URL: Reporting-Endpoints ignores a relative endpoint`);
  }
  // The URL parser lower-cases the host and writes an IPv4 address as four decimals, so these match every spelling.
  const local = parsed.protocol === "http:" && /^(127(\.\d{1,3}){3}|\[::1\]|(.+\.)?localhost\.?)$/.test(parsed.hostname);
  if (parsed.protocol !== "https:" && !local) throw new Error(`${parsed.href} is not https or http on a loopback host: Reporting-Endpoints ignores an endpoint that is not potentially trustworthy`);
  return `${group}="${parsed.href}"`;
}
