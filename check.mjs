/**
 * The reusable half of dustinedwards.info's header gate: what a response must carry, checked on the
 * response itself. A site runs it in CI against its own rendered responses (a Worker test, or the CLI
 * in bin/ against a preview or deployed origin).
 *
 * Every check names the failure it prevents (capsid/research/design-shared-functions.md, point 5):
 * sites sending no security headers at all, and report-only policies with no report sink, which enforce
 * nothing and tell nobody.
 */

import { CLOUDFLARE_WEB_ANALYTICS } from "./csp.mjs";
import { STANDARD_SECURITY_HEADERS } from "./headers.mjs";

/** @typedef {{ name: string, pass: boolean, detail: string }} CheckResult */

const ONE_YEAR = 31536000;
const STRICT_REFERRER = new Set(["no-referrer", "same-origin", "strict-origin", "strict-origin-when-cross-origin"]);

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
 * @param {Headers} headers a real response's headers
 * @param {{ standard?: Readonly<Record<string, string>>, csp?: boolean, cloudflareWebAnalytics?: boolean }} [options]
 *   `standard`: the floor (default STANDARD_SECURITY_HEADERS; a site passes the set it declared). `csp`: grade the
 *   policy too; false for a response that carries none by design, such as a feed or an image.
 *   `cloudflareWebAnalytics`: the site is Cloudflare-proxied with Web Analytics on, so the policy must let the injected
 *   beacon run (its script path prefix) and report (connect-src with the site itself).
 * @returns {CheckResult[]}
 */
export function checkSecurityHeaders(headers, { standard = STANDARD_SECURITY_HEADERS, csp = true, cloudflareWebAnalytics = false } = {}) {
  /** @type {CheckResult[]} */
  const results = [];
  const result = (/** @type {string} */ name, /** @type {boolean} */ pass, /** @type {string} */ detail) =>
    results.push({ name, pass, detail });

  for (const [name, floor] of Object.entries(standard)) {
    const got = headers.get(name);
    if (got === null) {
      result(`${name} is present`, false, "ABSENT");
      continue;
    }
    if (name === "Strict-Transport-Security") {
      const age = Number(/max-age=(\d+)/i.exec(got)?.[1] ?? 0);
      const want = Number(/max-age=(\d+)/i.exec(floor)?.[1] ?? ONE_YEAR);
      result(`${name} lasts at least ${want} seconds`, age >= want, `got ${JSON.stringify(got)}`);
      if (/includeSubDomains/i.test(floor)) result(`${name} covers subdomains`, /(^|;)\s*includeSubDomains\s*(;|$)/i.test(got), `got ${JSON.stringify(got)}`);
    } else if (name === "Referrer-Policy") {
      result(`${name} is a strict policy`, STRICT_REFERRER.has(got.trim().toLowerCase()), `got ${JSON.stringify(got)}`);
    } else if (name === "X-Frame-Options") {
      result(`${name} refuses framing`, /^(deny|sameorigin)$/i.test(got.trim()), `got ${JSON.stringify(got)}`);
    } else if (name === "Permissions-Policy") {
      const denied = deniedFeatures(got);
      const missing = [...deniedFeatures(floor)].filter((f) => !denied.has(f));
      result(`${name} denies ${[...deniedFeatures(floor)].join(", ")}`, missing.length === 0, missing.length ? `allows ${missing.join(", ")}; got ${JSON.stringify(got)}` : "");
    } else {
      result(`${name} is ${JSON.stringify(floor)}`, got.trim().toLowerCase() === floor.toLowerCase(), `got ${JSON.stringify(got)}`);
    }
  }

  if (!csp) return results;

  const enforced = headers.get("Content-Security-Policy");
  const reportOnly = headers.get("Content-Security-Policy-Report-Only");
  result(
    "the Content-Security-Policy is enforced, not only reported",
    Boolean(enforced),
    enforced ? "" : reportOnly ? "only a Report-Only policy is sent, which blocks nothing" : "ABSENT",
  );
  if (!enforced) return results;

  const policy = parsePolicy(enforced);
  const scripts = policy.get("script-src") ?? policy.get("default-src");
  result("the policy governs scripts (script-src or default-src)", Boolean(scripts), "neither directive is present, so any script runs");
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
    result(`${label}: no 'unsafe-inline'`, !keywords.includes("'unsafe-inline'"), `${noun} sources: ${sources.join(" ")}`);
    result(`${label}: no 'unsafe-eval'`, !keywords.includes("'unsafe-eval'"), `${noun} sources: ${sources.join(" ")}`);
    // A worker from a blob: URL is one the page's own script made, which already had to run, so workers may use blob:.
    const schemes = label === "worker-src" ? /^(https?|data):$/i : /^(https?|data|blob):$/i;
    const broad = sources.filter((s) => /^([a-z][a-z0-9+.-]*:\/\/)?\*(:(\d+|\*))?(\/.*)?$/i.test(s) || schemes.test(s));
    result(`${label}: no wildcard or bare scheme source`, broad.length === 0, broad.length ? `allows ${broad.join(" ")}` : "");
  }
  const objects = policy.get("object-src") ?? policy.get("default-src");
  result("object-src is 'none'", objects?.length === 1 && objects[0] === "'none'", `got ${objects ? objects.join(" ") : "ABSENT"}`);
  const base = policy.get("base-uri");
  result("base-uri is 'none' or 'self'", base?.length === 1 && (base[0] === "'none'" || base[0] === "'self'"), `got ${base ? base.join(" ") : "ABSENT (it does not fall back to default-src)"}`);
  const ancestors = policy.get("frame-ancestors");
  result(
    "frame-ancestors is 'none' or 'self'",
    ancestors?.length === 1 && (ancestors[0] === "'none'" || ancestors[0] === "'self'"),
    `got ${ancestors ? ancestors.join(" ") : "ABSENT (it does not fall back to default-src)"}`,
  );
  // form-action may be absent: an OAuth consent page leaves it out on purpose, since browsers apply it to every redirect
  // hop and the last hop is the client's redirect_uri. When it is present it must keep forms on this origin.
  const forms = policy.get("form-action");
  result(
    "form-action, when set, is 'self' or 'none'",
    !forms || (forms.length === 1 && (forms[0] === "'self'" || forms[0] === "'none'")),
    `got ${forms ? forms.join(" ") : "ABSENT"}`,
  );
  if (cloudflareWebAnalytics) {
    const missingScript = CLOUDFLARE_WEB_ANALYTICS.script.filter((source) => !(scripts ?? []).includes(source));
    const connect = policy.get("connect-src") ?? policy.get("default-src") ?? [];
    result(
      "the policy lets the Cloudflare Web Analytics beacon run: its script path prefix",
      missingScript.length === 0,
      `script-src lacks ${missingScript.join(" and ")}: the edge injects /beacon.min.js/v..., which the bare file URL does not match`,
    );
    result("the policy lets the beacon report: connect-src includes the site itself", connect.includes("'self'"), `connect-src is ${connect.join(" ") || "ABSENT"}`);
  }
  result(
    "violations are reported somewhere (report-uri or report-to)",
    policy.has("report-uri") || policy.has("report-to"),
    "no report sink: a blocked script is never heard about",
  );
  return results;
}

/**
 * @param {CheckResult[]} results
 * @returns {CheckResult[]}
 */
export const failures = (results) => results.filter((r) => !r.pass);
