/**
 * The reusable half of dustinedwards.info's header gate: what a response must carry, checked on the
 * response itself. A site runs it in CI against its own rendered responses (a Worker test), and the
 * site-runtime-security bin runs it against the live site.
 *
 * Every check names the failure it prevents (capsid/research/design-shared-functions.md, point 5):
 * sites sending no security headers at all, and report-only policies with no report sink, which enforce
 * nothing and tell nobody. Each result carries the checklist item it proves (`id`: T2, H1, C4 and so on, the
 * ids the live check reports under), and a `warn` result is advice that fails nothing.
 */

import { CLOUDFLARE_WEB_ANALYTICS, CSP_REPORT_GROUP, CSP_REPORT_PATH, broadSource } from "./csp.mjs";
import { allowlistBypass } from "./csp-bypasses.mjs";
import { EMBED_FRAME_SOURCES } from "./embeds.mjs";
import { STANDARD_SECURITY_HEADERS, buildSecurityHeaders, corpFor } from "./headers.mjs";
import { OWASP_REMOVE } from "./owasp-headers.mjs";
import { FAMILY_DEVIATIONS, SITE_DEVIATIONS } from "./sites-deviations.mjs";
import { SITES, siteEntry } from "./sites-values.mjs";

/**
 * The entry a check grades against: by id, or for the registry's own entry (the values a Worker imports, ./sites),
 * those values with the deviations they leave out; any other object as it is.
 * @param {string | import("./sites.mjs").SiteEntry | undefined} site
 * @returns {import("./sites.mjs").SiteEntry | undefined}
 */
function registryEntry(site) {
  const values = typeof site === "string" ? siteEntry(site) : SITES.find((s) => s === site);
  if (!values) return site;
  const deviations = /** @type {Record<string, import("./sites.mjs").SiteEntry["deviations"]>} */ (SITE_DEVIATIONS)[values.id];
  return deviations ? { ...values, deviations } : values;
}

/**
 * @typedef {{ id: string, name: string, pass: boolean, detail: string, warn?: boolean, notice?: boolean }} CheckResult
 *   `warn`: advice, or an item the site declared a deviation for; `notice`: an item no family site can meet
 *   (FAMILY_DEVIATIONS). Neither fails anything.
 */

const ONE_YEAR = 31536000;
const DAY = 86_400_000;
/** The checklist item each header of the set proves. */
const ITEM = /** @type {Record<string, string>} */ ({
  "Strict-Transport-Security": "T2",
  "X-Content-Type-Options": "H1",
  "X-Frame-Options": "H3",
  "Referrer-Policy": "H4",
  "Permissions-Policy": "H5",
  "X-Permitted-Cross-Domain-Policies": "H8",
  "X-DNS-Prefetch-Control": "H8",
  "Cross-Origin-Opener-Policy": "I1",
  "Cross-Origin-Resource-Policy": "I2",
  "Cross-Origin-Embedder-Policy": "I3",
  "Cross-Origin-Embedder-Policy-Report-Only": "I3",
  "Integrity-Policy": "S2",
  "Integrity-Policy-Report-Only": "S2",
});
/** Headers that govern a document, so only a document needs them (ASVS 3.4.8). */
const DOCUMENT_ONLY = new Set([
  "Cross-Origin-Opener-Policy", "Cross-Origin-Embedder-Policy", "Cross-Origin-Embedder-Policy-Report-Only", "Integrity-Policy", "Integrity-Policy-Report-Only",
]);
/** Headers every browser has dropped; sending one says the set was copied from an old guide. */
const DEPRECATED = ["X-XSS-Protection", "Expect-CT", "Feature-Policy"];
/** A cookie that holds a sign-in or a secret, which script must never read. */
const SESSION_COOKIE = /sess|auth|token|sid|login|csrf|state/i;
/** The fetch directives, each graded for broad sources (C5). */
const FETCH_DIRECTIVES = [
  "default-src", "script-src", "script-src-elem", "script-src-attr", "style-src", "style-src-elem", "style-src-attr", "img-src",
  "font-src", "connect-src", "media-src", "object-src", "frame-src", "child-src", "worker-src", "manifest-src", "fenced-frame-src",
];

/**
 * A failed result an entry or the family declined, as the reason, or "". Only results a check marks as declinable are
 * looked up: K1's cookie prefix, the items every site is graded on unless it declines them (S2, C3, C7, C9, I3), and
 * the family's (FAMILY_DEVIATIONS).
 * @param {import("./sites.mjs").SiteEntry | undefined} entry
 * @param {string} id
 * @param {string} [name] the cookie or thing the result is about, which a deviation's `value` must list when it has one
 * @returns {{ reason: string, family: boolean } | undefined}
 */
export function declined(entry, id, name) {
  const family = /** @type {Record<string, string>} */ (FAMILY_DEVIATIONS)[id];
  if (family) return { reason: family, family: true };
  const own = registryEntry(entry)?.deviations?.[id];
  if (own && (!own.value || (name !== undefined && own.value.includes(name)))) return { reason: own.reason, family: false };
  return undefined;
}

/**
 * @param {string} policy
 * @returns {Map<string, string[]>} directive name to its sources, lower-cased names
 */
export function parsePolicy(policy) {
  /** @type {Map<string, string[]>} */
  const out = new Map();
  for (const part of policy.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (!name) continue;
    // The first occurrence wins, as browsers apply it.
    if (!out.has(name.toLowerCase())) out.set(name.toLowerCase(), sources);
  }
  return out;
}

/**
 * The features a Permissions-Policy denies outright (`feature=()`).
 *
 * @param {string} value
 */
function deniedFeatures(value) {
  return new Set([...value.matchAll(/([a-z-]+)=\(\s*\)/g)].map((m) => m[1]));
}

/**
 * @typedef {{
 *   site?: string,
 *   standard?: Readonly<Record<string, string>>,
 *   csp?: boolean,
 *   cloudflareWebAnalytics?: boolean,
 *   inlineScripts?: "unsafe-inline",
 *   formTargets?: readonly string[],
 *   framedBySameOrigin?: boolean,
 *   baseUriSelf?: boolean,
 *   inlineStyles?: boolean,
 *   strictDynamic?: boolean,
 *   trustedTypes?: true | "report-only",
 *   denyUnlisted?: boolean | "report-only",
 *   integrityPolicy?: "enforce" | "report-only",
 *   upload?: boolean,
 * }} CheckOptions
 *   `site`: an id in the registry (./sites); the floor is the set buildSecurityHeaders({ site }) builds, and the opt-ins
 *   below come from its entry, so a site is graded against exactly what it declared. Each option may still be passed.
 *   `standard`: the floor without a registry entry (default STANDARD_SECURITY_HEADERS). `csp`: grade the policy too;
 *   false for a response that carries none by design, such as a feed or an image.
 *   `cloudflareWebAnalytics`: the site is Cloudflare-proxied with Web Analytics on, so the policy must let the injected
 *   beacon run (its script path prefix) and report (connect-src with the site itself).
 *   `inlineScripts`: the site built its policy with the same opt-in (buildContentSecurityPolicy), so `'unsafe-inline'`
 *   is accepted on script-src alone; script-src-elem, script-src-attr and worker-src are still refused it.
 *   `formTargets`: the off-site form targets the site passed the builder, accepted after 'self' on form-action.
 *   `framedBySameOrigin` / `baseUriSelf`: true accepts 'self' beside 'none' on frame-ancestors and base-uri; false
 *   accepts 'none' alone. Left out (and no `site`), either is accepted.
 *   `inlineStyles`: `'unsafe-inline'` is accepted on style-src (C11); style-src-attr's is always accepted, since
 *   attributes run no code. Every registry site is graded on Integrity-Policy (S2), a strict script policy (C3:
 *   'strict-dynamic' beside a nonce or hash, or no script at all), Trusted Types (C7), default-src 'none' (C9), COEP
 *   (I3) and the family's report sink (C14: /csp-report, group csp-endpoint): a page that misses one fails, unless the
 *   entry declares a deviation for it, which makes it a warning, so the registry is the whole list of what each site
 *   skips. Without an entry only what the options declare is graded. `strictDynamic`, `trustedTypes`, `denyUnlisted` ("report-only" reads the
 *   Report-Only policy, as `trustedTypes` does) and `integrityPolicy` are what a site promised: declared, the item is
 *   held to that form and no deviation can excuse it. `upload`: the response is an uploaded file, held to A3 (nosniff,
 *   and a sandboxed policy or an attachment).
 */

/**
 * @param {Headers} headers a real response's headers
 * @param {CheckOptions} [options]
 * @returns {CheckResult[]}
 */
export function checkSecurityHeaders(headers, options = {}) {
  const entry = registryEntry(options.site);
  const optIn = (/** @type {keyof import("./sites.mjs").SiteOptIns} */ key) => entry?.optIns?.[key]?.value;
  const declared = (/** @type {"framedBySameOrigin" | "baseUriSelf"} */ key) => (entry ? Boolean(optIn(key)) : undefined);
  const {
    standard = entry ? buildSecurityHeaders({ site: entry }) : STANDARD_SECURITY_HEADERS,
    csp = true,
    cloudflareWebAnalytics = Boolean(optIn("cloudflareWebAnalytics")),
    inlineScripts = /** @type {"unsafe-inline" | undefined} */ (optIn("inlineScripts")),
    formTargets = /** @type {readonly string[]} */ (optIn("formTargets") ?? []),
    framedBySameOrigin = declared("framedBySameOrigin"),
    baseUriSelf = declared("baseUriSelf"),
    inlineStyles = Boolean(optIn("inlineStyles")),
    strictDynamic = Boolean(optIn("strictDynamic")),
    trustedTypes = /** @type {true | "report-only" | undefined} */ (optIn("trustedTypes")),
    denyUnlisted = /** @type {boolean | "report-only" | undefined} */ (optIn("denyUnlisted")),
    integrityPolicy = /** @type {"enforce" | "report-only" | undefined} */ (optIn("integrityPolicy")),
    upload = false,
  } = options;
  /** @type {CheckResult[]} */
  const results = [];
  /** `declinable`: the cookie or thing a declared deviation may cover, or true for the item as a whole. */
  const result = (/** @type {string} */ id, /** @type {string} */ name, /** @type {boolean} */ pass, /** @type {string} */ detail, warn = false, /** @type {string | boolean} */ declinable = false) => {
    const deviation = !pass && declinable ? declined(entry, id, typeof declinable === "string" ? declinable : undefined) : undefined;
    if (deviation) results.push({ id, name, pass, detail: `declared deviation: ${deviation.reason} (${detail})`, ...(deviation.family ? { notice: true } : { warn: true }) });
    else results.push({ id, name, pass, detail, ...(warn ? { warn } : {}) });
  };
  const contentType = headers.get("Content-Type") ?? "";
  const html = /^\s*text\/html/i.test(contentType);

  for (const [name, floor] of Object.entries(standard)) {
    const id = ITEM[name] ?? "A1";
    if (DOCUMENT_ONLY.has(name) && !html) continue;
    const got = headers.get(name);
    if (got === null) {
      result(id, `${name} is present`, false, "ABSENT");
      continue;
    }
    if (name === "Strict-Transport-Security") {
      const age = Number(/max-age=(\d+)/i.exec(got)?.[1] ?? 0);
      const want = Number(/max-age=(\d+)/i.exec(floor)?.[1] ?? ONE_YEAR);
      result(id, `${name} lasts at least ${want} seconds`, age >= want, `got ${JSON.stringify(got)}`);
      if (/includeSubDomains/i.test(floor)) result(id, `${name} covers subdomains`, /(^|;)\s*includeSubDomains\s*(;|$)/i.test(got), `got ${JSON.stringify(got)}`);
    } else if (name === "X-Frame-Options") {
      result(id, `${name} refuses framing`, /^(deny|sameorigin)$/i.test(got.trim()), `got ${JSON.stringify(got)}`);
    } else if (name === "Permissions-Policy") {
      const denied = deniedFeatures(got);
      const missing = [...deniedFeatures(floor)].filter((f) => !denied.has(f));
      result(id, `${name} denies ${[...deniedFeatures(floor)].join(", ")}`, missing.length === 0, missing.length ? `allows ${missing.join(", ")}; got ${JSON.stringify(got)}` : "");
    } else {
      // Shared media may be cross-origin (corpFor); everything else, Referrer-Policy included, is exactly what the site
      // declared, so a site that sends no-referrer cannot slide back to a looser policy that is still "strict".
      const accepted = name === "Cross-Origin-Resource-Policy" ? [floor, corpFor(contentType)] : [floor];
      result(id, `${name} is ${JSON.stringify(floor)}`, accepted.some((v) => got.trim().toLowerCase() === v.toLowerCase()), `got ${JSON.stringify(got)}`);
    }
  }

  if (/^\s*(text\/|[^;]*[/+]xml\s*(;|$))/i.test(contentType)) {
    result("H2", "a text or XML Content-Type names its charset", /;\s*charset=/i.test(contentType), `got ${JSON.stringify(contentType)}`);
  }
  // Cloudflare writes `Server: cloudflare` on every response it proxies, and a site cannot remove it.
  const naming = OWASP_REMOVE.filter((name) => {
    const got = headers.get(name);
    return got !== null && !(name === "Server" && got.trim().toLowerCase() === "cloudflare");
  });
  result("H6", "no header names the software that served it (OSHP's remove list)", naming.length === 0, `sends ${naming.map((n) => `${n}: ${headers.get(n)}`).join("; ")}`);
  const deprecated = DEPRECATED.filter((name) => headers.has(name));
  result("H7", `no deprecated header (${DEPRECATED.join(", ")})`, deprecated.length === 0, `sends ${deprecated.join(", ")}`);
  const cookies = headers.getSetCookie();
  for (const cookie of cookies) {
    const [pair = "", ...rest] = cookie.split(";");
    const name = pair.split("=")[0]?.trim() ?? "";
    const attrs = new Map(rest.map((a) => [a.split("=")[0]?.trim().toLowerCase() ?? "", a.split("=")[1]?.trim().toLowerCase() ?? ""]));
    result("K1", `cookie ${name} is Secure`, attrs.has("secure"), cookie.split(";").slice(1).join(";").trim());
    if (SESSION_COOKIE.test(name)) result("K2", `cookie ${name} is HttpOnly`, attrs.has("httponly"), "a sign-in or secret cookie that script can read");
    const sameSite = attrs.get("samesite");
    result("K3", `cookie ${name} sets SameSite (Strict or Lax, or None with Secure)`, sameSite === "strict" || sameSite === "lax" || (sameSite === "none" && attrs.has("secure")), `SameSite is ${sameSite ?? "ABSENT"}`);
    result("K1", `cookie ${name} has a __Host- or __Secure- prefix`, /^__(Host|Secure)-/.test(name), "a prefix makes the browser refuse the cookie unless it is Secure (and, for __Host-, host-only on /): hostCookie, ./headers", false, name);
  }
  // A response that sets a cookie is one person's; stored at the edge, it would hand that cookie to the next reader.
  if (cookies.length > 0) {
    const cache = headers.get("Cache-Control") ?? "";
    result("X1", "a response that sets a cookie is never stored by a shared cache (no-store or private)", /(^|,)\s*(no-store|private)\s*(,|$)/i.test(cache), `Cache-Control is ${cache ? JSON.stringify(cache) : "ABSENT"}`);
  }
  if (upload) {
    const sandbox = parsePolicy(headers.get("Content-Security-Policy") ?? "").get("sandbox");
    const inert = (sandbox !== undefined && !sandbox.some((t) => t.toLowerCase() === "allow-scripts")) || /^\s*attachment/i.test(headers.get("Content-Disposition") ?? "");
    result("A3", "an uploaded file is served nosniff", (headers.get("X-Content-Type-Options") ?? "").trim().toLowerCase() === "nosniff", "a browser may read it as another type (UPLOAD_HEADERS, ./headers)");
    result("A3", "an uploaded file runs no script: a sandboxed policy or an attachment", inert, "opened on its own, the file runs as the site (UPLOAD_HEADERS, ./headers)");
  }
  if (html) {
    // Declared in the entry, these are in the floor and graded above as exactly what buildSecurityHeaders writes.
    const integrityName = integrityPolicy === "report-only" ? "Integrity-Policy-Report-Only" : integrityPolicy ? "Integrity-Policy" : undefined;
    if (integrityName ? !(integrityName in standard) : entry) {
      const got = (integrityName ? headers.get(integrityName) : (headers.get("Integrity-Policy") ?? headers.get("Integrity-Policy-Report-Only"))) ?? "";
      const label = integrityName ?? "Integrity-Policy (or its Report-Only form)";
      result("S2", `${label} blocks scripts without integrity${integrityName ? " (declared: integrityPolicy)" : ""}`, /blocked-destinations=\([^)]*\bscript\b[^)]*\)/i.test(got), got ? `got ${JSON.stringify(got)}` : "ABSENT: declare integrityPolicy in the entry (buildSecurityHeaders writes it)", false, !integrityName);
    }
    if (entry && !("Cross-Origin-Embedder-Policy" in standard) && !("Cross-Origin-Embedder-Policy-Report-Only" in standard)) {
      const got = headers.get("Cross-Origin-Embedder-Policy") ?? headers.get("Cross-Origin-Embedder-Policy-Report-Only") ?? "";
      result("I3", "Cross-Origin-Embedder-Policy (or its Report-Only form) is credentialless or require-corp", /^\s*(credentialless|require-corp)\s*(;|$)/i.test(got), got ? `got ${JSON.stringify(got)}` : "ABSENT: declare coep in the entry (buildSecurityHeaders writes it)", false, true);
    }
  }

  if (!csp) return results;

  const enforced = headers.get("Content-Security-Policy");
  const reportOnly = headers.get("Content-Security-Policy-Report-Only");
  result(
    "C1",
    "the Content-Security-Policy is enforced, not only reported",
    Boolean(enforced),
    enforced ? "" : reportOnly ? "only a Report-Only policy is sent, which blocks nothing" : "ABSENT",
  );
  if (!enforced) return results;

  // Headers joins a repeated header with ", ", and no source holds a comma, so a comma means two policies, which a
  // browser enforces together: the stricter wins on every directive, and a page breaks for no reason anyone can read.
  result("C13", "one enforced policy, sent once", !enforced.includes(","), "two policies were sent (they arrive joined by a comma); send one");
  const names = enforced.split(";").map((part) => part.trim().split(/\s+/)[0]?.toLowerCase() ?? "").filter(Boolean);
  const repeated = names.filter((n, i) => names.indexOf(n) !== i);
  result("C13", "no directive is written twice", repeated.length === 0, `${[...new Set(repeated)].join(", ")} repeated: a browser applies the first and ignores the rest`);
  const policy = parsePolicy(enforced);
  const scripts = policy.get("script-src") ?? policy.get("default-src");
  result("C4", "the policy governs scripts (script-src or default-src)", Boolean(scripts), "neither directive is present, so any script runs");
  // script-src-elem and script-src-attr override script-src for the scripts they govern, and worker-src for workers, so
  // each one present is held to the same rules.
  const scriptDirectives = /** @type {Array<[string, string[]]>} */ ([
    ["scripts", scripts ?? []],
    ...["script-src-elem", "script-src-attr", "worker-src"].flatMap((d) => (policy.has(d) ? [[d, policy.get(d) ?? []]] : [])),
  ]);
  for (const [label, sources] of scripts ? scriptDirectives : scriptDirectives.slice(1)) {
    // Browsers match keywords in any case.
    const keywords = sources.map((s) => s.toLowerCase());
    const noun = label === "scripts" ? "script" : label;
    const inlineDeclared = label === "scripts" && inlineScripts === "unsafe-inline";
    result("C4", `${label}: no 'unsafe-inline'${inlineDeclared ? " (declared: inlineScripts)" : ""}`, inlineDeclared || !keywords.includes("'unsafe-inline'"), `${noun} sources: ${sources.join(" ")}`);
    result("C4", `${label}: no 'unsafe-eval'`, !keywords.includes("'unsafe-eval'"), `${noun} sources: ${sources.join(" ")}`);
    // A JSONP or AngularJS host runs script only where scripts or workers load, so only these are held to it.
    const bypasses = sources.flatMap((s) => {
      const bypass = allowlistBypass(s);
      return bypass ? [`${s} (${bypass})`] : [];
    });
    result("C5", `${label}: no host known to serve JSONP, AngularJS or Flash (csp-evaluator)`, bypasses.length === 0, `allows ${bypasses.join(", ")}`);
  }
  for (const directive of FETCH_DIRECTIVES) {
    const sources = policy.get(directive);
    if (!sources) continue;
    const rule = directive === "default-src" && !policy.has("script-src") ? "script-src" : directive;
    const broad = sources.flatMap((s) => {
      const why = broadSource(s, rule);
      return why ? [`${s} (${why})`] : [];
    });
    result("C5", `${directive}: no wildcard or bare scheme source`, broad.length === 0, `allows ${broad.join(", ")}`);
  }
  // 'unsafe-inline' beside a nonce or hash is ignored by browsers, so only an effective one counts. Style attributes
  // (style-src-attr) run no code and are the one inline allowance the builder offers.
  for (const directive of ["style-src", "style-src-elem"]) {
    const sources = (policy.get(directive) ?? (directive === "style-src" ? policy.get("default-src") : undefined) ?? []).map((s) => s.toLowerCase());
    if (!sources.includes("'unsafe-inline'") || sources.some((s) => /^'(nonce|sha(256|384|512))-/.test(s))) continue;
    result("C11", `${directive}: no 'unsafe-inline'${inlineStyles ? " (declared: inlineStyles)" : ""}`, inlineStyles, `style sources: ${sources.join(" ")}`);
  }
  // C3: a strict script policy, 'strict-dynamic' beside a nonce or hash, or no script at all ('none').
  const scriptList = scripts ?? [];
  const noScript = scriptList.length === 1 && scriptList[0] === "'none'";
  if (strictDynamic || entry) result(
    "C3",
    `script-src is strict: 'strict-dynamic' beside a nonce or hash, or 'none'${strictDynamic ? " (declared: strictDynamic)" : ""}`,
    noScript || (scriptList.includes("'strict-dynamic'") && scriptList.some((s) => /^'(nonce|sha(256|384|512))-/.test(s))),
    `script sources: ${scriptList.join(" ")}`,
    false,
    !strictDynamic,
  );
  const staged = parsePolicy(reportOnly ?? "");
  const stagedLabel = (/** @type {unknown} */ declaredAs) => (declaredAs === "report-only" ? "the Report-Only policy" : "the policy");
  const fallback = (denyUnlisted === "report-only" ? staged : policy).get("default-src");
  if (denyUnlisted || entry) result(
    "C9",
    `${stagedLabel(denyUnlisted)}: default-src is 'none'${denyUnlisted ? " (declared: denyUnlisted)" : ""}`,
    fallback?.length === 1 && fallback[0] === "'none'",
    `got ${fallback ? fallback.join(" ") : "ABSENT"}`,
    false,
    !denyUnlisted,
  );
  const types = (trustedTypes === "report-only" ? staged : policy).get("require-trusted-types-for");
  if (trustedTypes || entry) result(
    "C7",
    `${stagedLabel(trustedTypes)} requires Trusted Types for scripts${trustedTypes ? " (declared: trustedTypes)" : ""}`,
    (types ?? []).includes("'script'"),
    `require-trusted-types-for is ${types?.join(" ") ?? "ABSENT"}`,
    false,
    !trustedTypes,
  );
  // A site that embeds post players (./embeds) lets every one of them into its frames, or a reader's click loads nothing.
  if (optIn("embeds")) {
    const frames = (policy.get("frame-src") ?? policy.get("child-src") ?? policy.get("default-src") ?? []).map((s) => s.toLowerCase());
    const shut = EMBED_FRAME_SOURCES.filter((o) => !frames.includes(o));
    result("C16", "frame-src lets in every post player (declared: embeds)", shut.length === 0, `refuses ${shut.join(" ")} (EMBED_FRAME_SOURCES, ./embeds)`);
  }
  const objects = policy.get("object-src") ?? policy.get("default-src");
  result("C2", "object-src is 'none'", objects?.length === 1 && objects[0] === "'none'", `got ${objects ? objects.join(" ") : "ABSENT"}`);
  // A declared opt-in allows 'self' (a site may use it on some pages only); a site entry that does not declare it allows 'none' alone.
  const one = (/** @type {boolean | undefined} */ self) => (self === false ? ["'none'"] : ["'none'", "'self'"]);
  const base = policy.get("base-uri");
  const bases = one(baseUriSelf);
  result("C2", `base-uri is ${bases.join(" or ")}`, base?.length === 1 && bases.includes(base[0] ?? ""), `got ${base ? base.join(" ") : "ABSENT (it does not fall back to default-src)"}`);
  const ancestors = policy.get("frame-ancestors");
  const framers = one(framedBySameOrigin);
  result(
    "H3",
    `frame-ancestors is ${framers.join(" or ")}`,
    ancestors?.length === 1 && framers.includes(ancestors[0] ?? ""),
    `got ${ancestors ? ancestors.join(" ") : "ABSENT (it does not fall back to default-src)"}`,
  );
  // form-action may be absent: an OAuth consent page leaves it out on purpose, since browsers apply it to every redirect
  // hop and the last hop is the client's redirect_uri. When it is present it must keep forms on this origin, beside
  // the off-site targets the site declared (formTargets, as it passed them to the builder).
  const forms = policy.get("form-action");
  const declaredForms = formTargets.length > 0;
  result(
    "C8",
    `form-action, when set, is 'self' or 'none'${declaredForms ? " (and the declared formTargets)" : ""}`,
    !forms ||
      (forms.length === 1 && (forms[0] === "'self'" || forms[0] === "'none'")) ||
      (forms[0] === "'self'" && forms.length > 1 && forms.slice(1).every((target) => formTargets.includes(target))),
    `got ${forms ? forms.join(" ") : "ABSENT"}`,
  );
  if (cloudflareWebAnalytics) {
    const missingScript = CLOUDFLARE_WEB_ANALYTICS.script.filter((source) => !(scripts ?? []).includes(source));
    const connect = policy.get("connect-src") ?? policy.get("default-src") ?? [];
    result(
      "C15",
      "the policy lets the Cloudflare Web Analytics beacon run: its script path prefix",
      missingScript.length === 0,
      `script-src lacks ${missingScript.join(" and ")}: the edge injects /beacon.min.js/v..., which the bare file URL does not match`,
    );
    result("C15", "the policy lets the beacon report: connect-src includes the site itself", connect.includes("'self'"), `connect-src is ${connect.join(" ") || "ABSENT"}`);
  }
  const sinks = ["report-uri", "report-to"].filter((d) => !policy.has(d));
  result("C14", "violations are reported to both sinks (report-uri and report-to)", sinks.length === 0, `no ${sinks.join(" and ")}: ${sinks.length === 2 ? "a blocked script is never heard about" : "the browsers that read only the other one report nowhere"}`);
  const reportUri = policy.get("report-uri")?.[0];
  const group = policy.get("report-to")?.[0];
  if (entry && reportUri) {
    const path = URL.parse(reportUri, "https://site.invalid")?.pathname;
    result("C14", `report-uri is the family's ${CSP_REPORT_PATH}`, path === CSP_REPORT_PATH, `got ${reportUri} (CSP_REPORT_PATH, ./csp)`);
  }
  if (entry && group) result("C14", `report-to names the family's group ${CSP_REPORT_GROUP}`, group === CSP_REPORT_GROUP, `got ${group} (CSP_REPORT_GROUP, ./csp)`);
  // Every group a header reports to (the policy's report-to, COEP's report-to, Integrity-Policy's endpoints) must be
  // one Reporting-Endpoints defines, or its reports go nowhere.
  const endpoints = headers.get("Reporting-Endpoints") ?? "";
  const groups = new Set([
    ...(group ? [group] : []),
    ...["Cross-Origin-Embedder-Policy", "Cross-Origin-Embedder-Policy-Report-Only"].flatMap((n) => /report-to="([^"]+)"/.exec(headers.get(n) ?? "")?.[1] ?? []),
    ...["Integrity-Policy", "Integrity-Policy-Report-Only"].flatMap((n) => /endpoints=\(([^)]*)\)/.exec(headers.get(n) ?? "")?.[1]?.trim().split(/\s+/).filter(Boolean) ?? []),
  ]);
  for (const name of groups) {
    const url = new RegExp(`(?:^|,)\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*"([^"]*)"`).exec(endpoints)?.[1] ?? "";
    result(
      "M1",
      `Reporting-Endpoints names the report group ${name} with an https URL`,
      /^https:\/\//i.test(url) || /^http:\/\/(127(\.\d{1,3}){3}|\[::1\]|(.+\.)?localhost)(:\d+)?\//i.test(url),
      endpoints ? `got ${JSON.stringify(endpoints)}` : "Reporting-Endpoints is ABSENT, so its reports go nowhere",
    );
  }
  return results;
}

/**
 * The failed results, warnings and notices left out.
 * @param {CheckResult[]} results
 * @returns {CheckResult[]}
 */
export const failures = (results) => results.filter((r) => !r.pass && !r.warn && !r.notice);

/**
 * /.well-known/security.txt graded against RFC 9116: served 200 as `text/plain; charset=utf-8` (D1), one Contact and
 * exactly one Expires under a year out (D2), a warning 30 days before it (D4), and a Canonical naming the URL it is
 * served from or the site's own (D3). An OpenPGP-signed file must carry its whole signature block, and its fields are
 * read from the signed text; an unsigned one is the family's deviation (FAMILY_DEVIATIONS.D3).
 * @param {{ url: string, origin?: string, status: number, headers: Headers, body: string, now?: number }} response
 *   `url` where it was fetched; `origin` the site's own, when it is served from elsewhere
 * @param {{ site?: string | import("./sites.mjs").SiteEntry }} [options]
 * @returns {CheckResult[]}
 */
export function checkSecurityTxt({ url, origin, status, headers, body, now = Date.now() }, { site } = {}) {
  const entry = registryEntry(site);
  /** @type {CheckResult[]} */
  const results = [];
  const result = (/** @type {string} */ id, /** @type {string} */ name, /** @type {boolean} */ pass, /** @type {string} */ detail, warn = false, declinable = false) => {
    const deviation = !pass && declinable ? declined(entry, id) : undefined;
    if (deviation) results.push({ id, name, pass, detail: `declared deviation: ${deviation.reason}`, ...(deviation.family ? { notice: true } : { warn: true }) });
    else results.push({ id, name, pass, detail, ...(warn ? { warn } : {}) });
  };
  result("D1", "security.txt is served", status === 200, `answers ${status}`);
  if (status !== 200) return results;
  const type = headers.get("Content-Type") ?? "";
  result("D1", "security.txt is text/plain; charset=utf-8", /^text\/plain\s*;\s*charset=utf-8$/i.test(type.trim()), `Content-Type is ${JSON.stringify(type)} (securityTxtResponse, ./security-txt)`);
  const signed = /^-----BEGIN PGP SIGNED MESSAGE-----\r?\n/.test(body);
  if (signed) {
    result("D3", "the OpenPGP signature is whole", /\n-----BEGIN PGP SIGNATURE-----\r?\n[\s\S]+\n-----END PGP SIGNATURE-----\s*$/.test(body), "the signed message has no complete signature block");
  } else {
    result("D3", "security.txt is OpenPGP-signed", false, "a cleartext signature lets a finder trust the contact without trusting the host", false, true);
  }
  const text = signed ? body.split(/\n-----BEGIN PGP SIGNATURE-----/)[0]?.replace(/^[\s\S]*?\r?\n\r?\n/, "").replace(/^- /gm, "") ?? "" : body;
  const fields = (/** @type {string} */ name) => [...text.matchAll(new RegExp(`^${name}:\\s*(.+?)\\s*$`, "gim"))].map((m) => m[1] ?? "");
  result("D2", "security.txt has a Contact", fields("Contact").length > 0, "no Contact: a finder has nowhere to write");
  const expires = fields("Expires");
  const left = (Date.parse(expires[0] ?? "") - now) / DAY;
  result("D2", "security.txt has exactly one Expires", expires.length === 1, `has ${expires.length} Expires fields`);
  if (expires.length === 1) {
    result("D2", "Expires is within the next year", left > 0 && left < 365, `Expires ${expires[0]}`);
    if (left > 0 && left < 365) result("D4", "Expires is more than 30 days out", left >= 30, `Expires ${expires[0]}, in ${Math.floor(left)} days`, true);
  }
  const canonical = fields("Canonical");
  const want = [url, ...(origin ? [new URL("/.well-known/security.txt", origin).href] : [])];
  if (canonical.length === 0) result("D3", "security.txt has a Canonical", false, "no Canonical: a copy found elsewhere cannot be told from the real one", true);
  else result("D3", "Canonical names the URL it is served from", canonical.some((c) => want.includes(c)), `Canonical ${canonical.join(", ")}`);
  return results;
}
