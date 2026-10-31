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

import { CLOUDFLARE_WEB_ANALYTICS, WILDCARD_HOST } from "./csp.mjs";
import { allowlistBypass } from "./csp-bypasses.mjs";
import { STANDARD_SECURITY_HEADERS, buildSecurityHeaders, corpFor } from "./headers.mjs";
import { OWASP_REMOVE } from "./owasp-headers.mjs";
import { siteEntry } from "./sites.mjs";

/** @typedef {{ id: string, name: string, pass: boolean, detail: string, warn?: boolean }} CheckResult */

const ONE_YEAR = 31536000;
const STRICT_REFERRER = new Set(["no-referrer", "same-origin", "strict-origin", "strict-origin-when-cross-origin"]);
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
});
/** Headers every browser has dropped; sending one says the set was copied from an old guide. */
const DEPRECATED = ["X-XSS-Protection", "Expect-CT", "Feature-Policy"];
/** A cookie that holds a sign-in or a secret, which script must never read. */
const SESSION_COOKIE = /sess|auth|token|sid|login|csrf|state/i;
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
 */

/**
 * @param {Headers} headers a real response's headers
 * @param {CheckOptions} [options]
 * @returns {CheckResult[]}
 */
export function checkSecurityHeaders(headers, options = {}) {
  const entry = typeof options.site === "string" ? siteEntry(options.site) : options.site;
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
  } = options;
  /** @type {CheckResult[]} */
  const results = [];
  const result = (/** @type {string} */ id, /** @type {string} */ name, /** @type {boolean} */ pass, /** @type {string} */ detail, warn = false) =>
    results.push({ id, name, pass, detail, ...(warn ? { warn } : {}) });
  const contentType = headers.get("Content-Type") ?? "";
  const html = /^\s*text\/html/i.test(contentType);

  for (const [name, floor] of Object.entries(standard)) {
    const id = ITEM[name] ?? "A1";
    // COOP governs a browsing context, so only a document needs it (ASVS 3.4.8).
    if (name === "Cross-Origin-Opener-Policy" && !html) continue;
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
    } else if (name === "Referrer-Policy") {
      result(id, `${name} is a strict policy`, STRICT_REFERRER.has(got.trim().toLowerCase()), `got ${JSON.stringify(got)}`);
    } else if (name === "X-Frame-Options") {
      result(id, `${name} refuses framing`, /^(deny|sameorigin)$/i.test(got.trim()), `got ${JSON.stringify(got)}`);
    } else if (name === "Permissions-Policy") {
      const denied = deniedFeatures(got);
      const missing = [...deniedFeatures(floor)].filter((f) => !denied.has(f));
      result(id, `${name} denies ${[...deniedFeatures(floor)].join(", ")}`, missing.length === 0, missing.length ? `allows ${missing.join(", ")}; got ${JSON.stringify(got)}` : "");
    } else {
      // Shared media may be cross-origin (corpFor); everything else keeps the floor.
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
  for (const cookie of headers.getSetCookie()) {
    const [pair = "", ...rest] = cookie.split(";");
    const name = pair.split("=")[0]?.trim() ?? "";
    const attrs = new Map(rest.map((a) => [a.split("=")[0]?.trim().toLowerCase() ?? "", a.split("=")[1]?.trim().toLowerCase() ?? ""]));
    result("K1", `cookie ${name} is Secure`, attrs.has("secure"), cookie.split(";").slice(1).join(";").trim());
    if (SESSION_COOKIE.test(name)) result("K2", `cookie ${name} is HttpOnly`, attrs.has("httponly"), "a sign-in or secret cookie that script can read");
    const sameSite = attrs.get("samesite");
    result("K3", `cookie ${name} sets SameSite (Strict or Lax, or None with Secure)`, sameSite === "strict" || sameSite === "lax" || (sameSite === "none" && attrs.has("secure")), `SameSite is ${sameSite ?? "ABSENT"}`);
    result("K1", `cookie ${name} has a __Host- or __Secure- prefix`, /^__(Host|Secure)-/.test(name), "a prefix makes the browser refuse the cookie unless it is Secure (and, for __Host-, host-only on /)", true);
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
    // Browsers match keywords in any case, and a host of `*` matches every host whatever the scheme, port or path.
    const keywords = sources.map((s) => s.toLowerCase());
    const noun = label === "scripts" ? "script" : label;
    const inlineDeclared = label === "scripts" && inlineScripts === "unsafe-inline";
    result("C4", `${label}: no 'unsafe-inline'${inlineDeclared ? " (declared: inlineScripts)" : ""}`, inlineDeclared || !keywords.includes("'unsafe-inline'"), `${noun} sources: ${sources.join(" ")}`);
    result("C4", `${label}: no 'unsafe-eval'`, !keywords.includes("'unsafe-eval'"), `${noun} sources: ${sources.join(" ")}`);
    // A worker from a blob: URL is one the page's own script made, which already had to run, so workers may use blob:.
    const schemes = label === "worker-src" ? /^(https?|data):$/i : /^(https?|data|blob):$/i;
    const broad = sources.filter((s) => /^([a-z][a-z0-9+.-]*:\/\/)?\*(:(\d+|\*))?(\/.*)?$/i.test(s) || WILDCARD_HOST.test(s) || schemes.test(s));
    result("C5", `${label}: no wildcard or bare scheme source`, broad.length === 0, broad.length ? `allows ${broad.join(" ")}` : "");
    const bypasses = sources.flatMap((s) => {
      const bypass = allowlistBypass(s);
      return bypass ? [`${s} (${bypass})`] : [];
    });
    result("C5", `${label}: no host known to serve JSONP, AngularJS or Flash (csp-evaluator)`, bypasses.length === 0, `allows ${bypasses.join(", ")}`);
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
  result(
    "C14",
    "violations are reported somewhere (report-uri or report-to)",
    policy.has("report-uri") || policy.has("report-to"),
    "no report sink: a blocked script is never heard about",
  );
  return results;
}

/**
 * The failed results, warnings left out.
 * @param {CheckResult[]} results
 * @returns {CheckResult[]}
 */
export const failures = (results) => results.filter((r) => !r.pass && !r.warn);
