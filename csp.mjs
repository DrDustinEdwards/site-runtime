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
 * - reportingEndpoints is the Reporting-Endpoints header that names a policy's report-to group. Every site reports
 *   to CSP_REPORT_PATH (/csp-report) under the group CSP_REPORT_GROUP (csp-endpoint), the builder's defaults.
 * - buildStagedPolicy is the Report-Only companion for a rollout (Trusted Types first); integrityPolicy is the
 *   Integrity-Policy header, and integrityHash the sha384 a static build writes into a tag's `integrity`.
 *
 * Which to use, nonce or hash: a response that is never shared-cached may carry a nonce. A response that is
 * edge-cached either trusts its inline scripts by hash, or keeps its nonce and has renewNonce give every response a
 * fresh one, in the header and on every element that carried the old one (Foxing's edge cache does this). Only when
 * neither can work does a site opt into `inlineScripts: "unsafe-inline"`.
 */

import { EMBED_FRAME_SOURCES } from "./embeds.mjs";

/** Where every site receives its reports (./csp-report): the default report-uri, and the path the check expects. */
export const CSP_REPORT_PATH = "/csp-report";

/** The report-to group every site names: the policy's, Integrity-Policy's endpoints and COEP's report-to. */
export const CSP_REPORT_GROUP = "csp-endpoint";

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
 * The `integrity` attribute value for a file a static build writes a tag for (`<script type="module" src
 * integrity crossorigin>`, a modulepreload): `sha384-<base64>` of its exact bytes. A classic script needs
 * `crossorigin` too, since Integrity-Policy refuses a no-cors script request whatever its integrity.
 * @param {string | ArrayBuffer | ArrayBufferView} content
 * @returns {Promise<string>}
 */
export async function integrityHash(content) {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const digest = await crypto.subtle.digest("SHA-384", bytes);
  return `sha384-${btoa(String.fromCharCode(...new Uint8Array(digest)))}`;
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
export const CLOUDFLARE_WEB_ANALYTICS = /* @__PURE__ */ Object.freeze({
  script: Object.freeze([
    "https://static.cloudflareinsights.com/beacon.min.js",
    "https://static.cloudflareinsights.com/beacon.min.js/",
  ]),
});

/** One https origin: a host name (no wildcard), an optional port, no path. */
const FORM_TARGET = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/;

/** A source expression as a policy writes it: no space, no semicolon, no comma. @param {string} source */
function checkSource(source) {
  if (typeof source !== "string" || source === "" || /[\s;,]/.test(source)) throw new Error(`${JSON.stringify(source)} is not a CSP source`);
  return source;
}

const ANY_HOST = /^([a-z][a-z0-9+.-]*:\/\/)?\*(:(\d+|\*))?(\/.*)?$/i;
const ANY_SUBDOMAIN = /^([a-z][a-z0-9+.-]*:\/\/)?\*\./i;
/** The schemes that name no host: a URL the page itself made or holds, never a network fetch. */
const LOCAL_SCHEMES = new Set(["data:", "blob:", "mediastream:", "filesystem:"]);
/** Where a source runs as script, so a data: or blob: URL there is script anyone who can write one can run. */
const SCRIPT_DIRECTIVES = new Set(["script-src", "script-src-elem", "script-src-attr"]);

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
export function broadSource(source, directive = "script-src") {
  if (ANY_HOST.test(source)) return "any host";
  if (ANY_SUBDOMAIN.test(source)) return "every subdomain of the host";
  if (!/^[a-z][a-z0-9+.-]*:$/i.test(source)) return "";
  const scheme = source.toLowerCase();
  const name = directive.toLowerCase();
  if (!LOCAL_SCHEMES.has(scheme)) return `any host over ${scheme}`;
  if (SCRIPT_DIRECTIVES.has(name) || ((name === "worker-src" || name === "child-src") && scheme === "data:")) return `script any page can write as ${scheme}`;
  return "";
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
export function buildContentSecurityPolicy(site) {
  const { sources = {}, scriptHashes = [], styleHashes = [], nonce, nonceStyles = true, inlineScripts, strictDynamic = false, styleAttributesInline = false, cloudflareWebAnalytics = false, reportUri = CSP_REPORT_PATH, reportTo = CSP_REPORT_GROUP, reportOnly = false, framedBySameOrigin = false, embeds = false, baseUriSelf = false, denyUnlisted = false, noForms = false, formTargets = [], trustedTypes, extraDirectives = [] } = site;
  if (!reportUri || !reportTo) throw new Error("a policy needs both report sinks: reportUri for browsers without the Reporting API, reportTo for the rest");
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
  if (noForms && formTargets.length > 0) throw new Error("formTargets cannot go with noForms: form-action 'none' refuses every form");
  for (const target of formTargets) {
    if (!FORM_TARGET.test(target)) throw new Error(`${JSON.stringify(target)} is not a form target: name one https origin, with no wildcard or path`);
  }
  const hashSource = (/** @type {string} */ h) => {
    if (!/^sha(256|384|512)-[A-Za-z0-9+/_-]+={0,2}$/.test(h)) throw new Error(`${JSON.stringify(h)} is not a hash source`);
    return `'${h}'`;
  };
  /** A kind's listed sources, each a source expression that names its hosts (broadSource). */
  const list = (/** @type {readonly string[] | undefined} */ hosts, /** @type {string} */ directive) =>
    (hosts ?? []).map((host) => {
      const why = broadSource(checkSource(host), directive);
      if (why) throw new Error(`${host} is not an acceptable ${directive} source: it allows ${why}; name the host`);
      return host;
    });

  const frames = [...(sources.frame ?? []), ...(embeds ? EMBED_FRAME_SOURCES.filter((o) => !(sources.frame ?? []).includes(o)) : [])];
  const scriptHosts = [...list(sources.script, "script-src"), ...(cloudflareWebAnalytics ? CLOUDFLARE_WEB_ANALYTICS.script : [])];
  for (const host of scriptHosts) {
    // Browsers match keywords in any case.
    if (/^'unsafe-(inline|eval)'$/i.test(host)) throw new Error(`${host} is not an acceptable script-src source: 'unsafe-inline' comes only from inlineScripts`);
    if (/^'strict-dynamic'$/i.test(host)) throw new Error("'strict-dynamic' is not a script source here: pass strictDynamic: true, which checks it has a nonce or hashes to start from");
  }
  const typeNames = trustedTypes === true || trustedTypes === undefined ? [] : trustedTypes;
  for (const name of typeNames) {
    if (!/^([A-Za-z0-9#=_/@.%-]+|'allow-duplicates'|'none')$/.test(name)) throw new Error(`${JSON.stringify(name)} is not a Trusted Types policy name`);
  }
  // An extra directive may add a kind the builder leaves out (worker-src, manifest-src, upgrade-insecure-requests), never
  // one it writes: a second directive of a name is ignored by browsers without a word. Nor may it reopen scripts or
  // styles past the nonce through an -elem or -attr variant (as Astro, packages/astro/src/core/csp/config.ts).
  const written = new Set([
    "default-src", "script-src", "script-src-elem", "script-src-attr", "style-src", "style-src-elem", "style-src-attr",
    "font-src", "img-src", "media-src", "connect-src", "frame-src", "object-src", "base-uri", "form-action",
    "frame-ancestors", "report-uri", "report-to", "require-trusted-types-for", "trusted-types",
  ]);
  for (const extra of extraDirectives) {
    const [name = "", ...values] = extra.trim().split(/\s+/);
    if (written.has(name.toLowerCase())) throw new Error(`${name} is written by the builder; pass its sources instead of an extra directive`);
    if (values.some((v) => broadSource(v, name) || (name.toLowerCase() === "worker-src" && /^'unsafe-(inline|eval)'$/i.test(v)))) {
      throw new Error(`${extra} is not an acceptable directive: name the hosts`);
    }
  }
  const nonceSource = nonce === undefined ? [] : [`'nonce-${nonce}'`];
  const directives = [
    `default-src ${denyUnlisted ? "'none'" : "'self'"}`,
    `script-src ${[...nonceSource, ...scriptHashes.map(hashSource), "'self'", ...(inlineScripts ? ["'unsafe-inline'"] : []), ...(strictDynamic ? ["'strict-dynamic'"] : []), ...scriptHosts].join(" ")}`,
    `style-src ${["'self'", ...(nonceStyles ? nonceSource : []), ...styleHashes.map(hashSource), ...list(sources.style, "style-src")].join(" ")}`,
    ...(styleAttributesInline ? ["style-src-attr 'unsafe-inline'"] : []),
    `font-src ${["'self'", ...list(sources.font, "font-src")].join(" ")}`,
    `img-src ${["'self'", ...list(sources.img, "img-src")].join(" ")}`,
    ...((sources.media ?? []).length > 0 ? [`media-src ${["'self'", ...list(sources.media, "media-src")].join(" ")}`] : []),
    // 'self' is always present: the Cloudflare beacon reports to /cdn-cgi/rum on the site's own origin.
    `connect-src ${["'self'", ...list(sources.connect, "connect-src")].join(" ")}`,
    ...(frames.length > 0 ? [`frame-src ${["'self'", ...list(frames, "frame-src")].join(" ")}`] : []),
    "object-src 'none'",
    `base-uri ${baseUriSelf ? "'self'" : "'none'"}`,
    `form-action ${noForms ? "'none'" : ["'self'", ...formTargets].join(" ")}`,
    `frame-ancestors ${framedBySameOrigin ? "'self'" : "'none'"}`,
    ...(trustedTypes ? ["require-trusted-types-for 'script'"] : []),
    ...(typeNames.length > 0 ? [`trusted-types ${typeNames.join(" ")}`] : []),
    ...extraDirectives,
    `report-uri ${checkSource(reportUri)}`,
    `report-to ${checkSource(reportTo)}`,
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

/**
 * The Report-Only companion for a staged rollout: the site's own policy with `staged` added (Trusted Types first:
 * `{ trustedTypes: ["default"] }`), sent beside the enforced one, so the reports show what the stricter policy would
 * block before it blocks anything. When they show nothing, move `staged` into the enforced policy and drop this one.
 * @param {SitePolicy} site the options the enforced policy is built from
 * @param {Partial<SitePolicy>} staged what the next policy adds
 * @returns {{ name: "Content-Security-Policy-Report-Only", value: string }}
 */
export function buildStagedPolicy(site, staged) {
  if (Object.keys(staged).length === 0) throw new Error("a staged policy stages nothing: name what it adds");
  const { value } = buildContentSecurityPolicy({ ...site, ...staged, reportOnly: true });
  return { name: "Content-Security-Policy-Report-Only", value };
}

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
export function integrityPolicy({ endpoint = CSP_REPORT_GROUP, reportOnly = false } = {}) {
  if (!/^[a-z*][a-z0-9_.*-]*$/.test(endpoint)) throw new Error(`${JSON.stringify(endpoint)} is not a Reporting-Endpoints group name`);
  return {
    name: reportOnly ? "Integrity-Policy-Report-Only" : "Integrity-Policy",
    value: `blocked-destinations=(script), endpoints=(${endpoint})`,
  };
}

const NONCE_SOURCE = /'nonce-([A-Za-z0-9+/_=-]+)'/;

/**
 * A stored page with a fresh nonce: the nonce its policy was rendered with becomes `nonce` in the Content-Security-Policy
 * (and Report-Only) header and on every <script>, <style> and <link> whose nonce attribute held it, so no two readers of
 * an edge-cached page share one, and an element injected without the old nonce gains none. Call it on every response
 * the cache answers, hit or miss. A response that is not HTML, or whose policy has no nonce, comes back as it is.
 * It needs HTMLRewriter (Workers), and throws without it rather than send the stored nonce again. This is the third
 * way to trust inline scripts on a cached page, beside hashes, and the one to use before `inlineScripts`.
 * @param {Response} response
 * @param {string} [nonce] the new nonce (generateNonce), when the caller needs to know it
 * @returns {Response}
 */
export function renewNonce(response, nonce = generateNonce()) {
  const headers = new Headers(response.headers);
  const names = ["Content-Security-Policy", "Content-Security-Policy-Report-Only"];
  const rendered = names.map((n) => NONCE_SOURCE.exec(headers.get(n) ?? "")?.[1]).find(Boolean);
  if (!rendered || !/text\/html/i.test(headers.get("Content-Type") ?? "")) return response;
  if (typeof HTMLRewriter === "undefined") throw new Error("renewNonce needs HTMLRewriter (a Workers runtime)");
  for (const name of names) {
    const value = headers.get(name);
    if (value) headers.set(name, value.replaceAll(`'nonce-${rendered}'`, `'nonce-${nonce}'`));
  }
  const rewrite = { element: (/** @type {any} */ el) => el.getAttribute("nonce") === rendered && el.setAttribute("nonce", nonce) };
  const body = new HTMLRewriter().on("script[nonce]", rewrite).on("style[nonce]", rewrite).on("link[nonce]", rewrite).transform(response).body;
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}
