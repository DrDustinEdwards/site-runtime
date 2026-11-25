/**
 * The reusable half of dustinedwards.info's header gate: what a response must carry, checked on the response
 * itself, in a site's CI (a Worker test) and by the site-runtime-security bin against the live site.
 *
 * Every check names the failure it prevents (capsid/research/design-shared-functions.md, point 5). Each result
 * carries the checklist item it proves (`id`: T2, H1, C4 and so on), and a `warn` result fails nothing.
 */

import { checkPolicy } from "./check-policy.mjs";
import { parsePolicy, registryEntry, resultRecorder } from "./check-core.mjs";
import { STANDARD_SECURITY_HEADERS, buildSecurityHeaders, corpFor } from "./headers.mjs";
import { OWASP_REMOVE } from "./owasp-headers.mjs";

export { declined, parsePolicy } from "./check-core.mjs";
export { checkSecurityTxt } from "./check-security-txt.mjs";

/** @typedef {import("./check-core.mjs").CheckResult} CheckResult */
/** @typedef {import("./check-core.mjs").CheckedSiteEntry} CheckedSiteEntry */

const ONE_YEAR = 31536000;
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
  "Cross-Origin-Opener-Policy",
  "Cross-Origin-Embedder-Policy",
  "Cross-Origin-Embedder-Policy-Report-Only",
  "Integrity-Policy",
  "Integrity-Policy-Report-Only",
]);
/** Headers every browser has dropped; sending one says the set was copied from an old guide. */
const DEPRECATED = ["X-XSS-Protection", "Expect-CT", "Feature-Policy"];
/** A cookie that holds a sign-in or a secret, which script must never read. */
const SESSION_COOKIE = /sess|auth|token|sid|login|csrf|state/i;

/**
 * The features a Permissions-Policy denies outright (`feature=()`).
 * @param {string} value
 */
function deniedFeatures(value) {
  return new Set([...value.matchAll(/([a-z-]+)=\(\s*\)/g)].map((m) => m[1]));
}

/**
 * @typedef {{
 *   site?: string | CheckedSiteEntry,
 *   standard?: Readonly<Record<string, string>>,
 *   csp?: boolean,
 *   cloudflareWebAnalytics?: boolean | "manual",
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
 *   beacon run (its script path prefix) and report (connect-src with the site itself). `"manual"`: the site is not
 *   proxied and carries the beacon tag itself, so script-src names the bare file and connect-src names
 *   https://cloudflareinsights.com, where that beacon reports.
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
 */
export function checkSecurityHeaders(headers, options = {}) {
  const entry = registryEntry(options.site);
  const optIn = (/** @type {keyof import("./sites.mjs").SiteOptIns} */ key) =>
    entry?.optIns?.[key]?.value;
  const declared = (/** @type {"framedBySameOrigin" | "baseUriSelf"} */ key) =>
    entry ? Boolean(optIn(key)) : undefined;
  const {
    standard = entry ? buildSecurityHeaders({ site: entry }) : STANDARD_SECURITY_HEADERS,
    csp = true,
    cloudflareWebAnalytics = /** @type {boolean | "manual"} */ (
      optIn("cloudflareWebAnalytics") ?? false
    ),
    inlineScripts = /** @type {"unsafe-inline" | undefined} */ (optIn("inlineScripts")),
    formTargets = /** @type {readonly string[]} */ (optIn("formTargets") ?? []),
    framedBySameOrigin = declared("framedBySameOrigin"),
    baseUriSelf = declared("baseUriSelf"),
    inlineStyles = Boolean(optIn("inlineStyles")),
    strictDynamic = Boolean(optIn("strictDynamic")),
    trustedTypes = /** @type {true | "report-only" | undefined} */ (optIn("trustedTypes")),
    denyUnlisted = /** @type {boolean | "report-only" | undefined} */ (optIn("denyUnlisted")),
    integrityPolicy = /** @type {"enforce" | "report-only" | undefined} */ (
      optIn("integrityPolicy")
    ),
    upload = false,
  } = options;
  /** @type {CheckResult[]} */
  const results = [];
  const result = resultRecorder(results, entry, true);
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
      result(
        id,
        `${name} lasts at least ${want} seconds`,
        age >= want,
        `got ${JSON.stringify(got)}`,
      );
      if (/includeSubDomains/i.test(floor))
        result(
          id,
          `${name} covers subdomains`,
          /(^|;)\s*includeSubDomains\s*(;|$)/i.test(got),
          `got ${JSON.stringify(got)}`,
        );
    } else if (name === "X-Frame-Options") {
      result(
        id,
        `${name} refuses framing`,
        /^(deny|sameorigin)$/i.test(got.trim()),
        `got ${JSON.stringify(got)}`,
      );
    } else if (name === "Permissions-Policy") {
      const denied = deniedFeatures(got);
      const missing = [...deniedFeatures(floor)].filter((f) => !denied.has(f));
      result(
        id,
        `${name} denies ${[...deniedFeatures(floor)].join(", ")}`,
        missing.length === 0,
        missing.length ? `allows ${missing.join(", ")}; got ${JSON.stringify(got)}` : "",
      );
    } else {
      // Shared media may be cross-origin (corpFor); everything else is exactly what the site declared, so no-referrer
      // cannot slide back to a looser "strict" policy.
      const accepted =
        name === "Cross-Origin-Resource-Policy" ? [floor, corpFor(contentType)] : [floor];
      result(
        id,
        `${name} is ${JSON.stringify(floor)}`,
        accepted.some((v) => got.trim().toLowerCase() === v.toLowerCase()),
        `got ${JSON.stringify(got)}`,
      );
    }
  }

  if (/^\s*(text\/|[^;]*[/+]xml\s*(;|$))/i.test(contentType)) {
    result(
      "H2",
      "a text or XML Content-Type names its charset",
      /;\s*charset=/i.test(contentType),
      `got ${JSON.stringify(contentType)}`,
    );
  }
  // Cloudflare writes `Server: cloudflare` on every response it proxies, and a site cannot remove it.
  const naming = OWASP_REMOVE.filter((name) => {
    const got = headers.get(name);
    return got !== null && !(name === "Server" && got.trim().toLowerCase() === "cloudflare");
  });
  result(
    "H6",
    "no header names the software that served it (OSHP's remove list)",
    naming.length === 0,
    `sends ${naming.map((n) => `${n}: ${headers.get(n)}`).join("; ")}`,
  );
  const deprecated = DEPRECATED.filter((name) => headers.has(name));
  result(
    "H7",
    `no deprecated header (${DEPRECATED.join(", ")})`,
    deprecated.length === 0,
    `sends ${deprecated.join(", ")}`,
  );
  const cookies = headers.getSetCookie();
  for (const cookie of cookies) {
    const [pair = "", ...rest] = cookie.split(";");
    const name = pair.split("=")[0]?.trim() ?? "";
    const attrs = new Map(
      rest.map((a) => [
        a.split("=")[0]?.trim().toLowerCase() ?? "",
        a.split("=")[1]?.trim().toLowerCase() ?? "",
      ]),
    );
    result(
      "K1",
      `cookie ${name} is Secure`,
      attrs.has("secure"),
      cookie.split(";").slice(1).join(";").trim(),
    );
    if (SESSION_COOKIE.test(name))
      result(
        "K2",
        `cookie ${name} is HttpOnly`,
        attrs.has("httponly"),
        "a sign-in or secret cookie that script can read",
      );
    const sameSite = attrs.get("samesite");
    result(
      "K3",
      `cookie ${name} sets SameSite (Strict or Lax, or None with Secure)`,
      sameSite === "strict" || sameSite === "lax" || (sameSite === "none" && attrs.has("secure")),
      `SameSite is ${sameSite ?? "ABSENT"}`,
    );
    result(
      "K1",
      `cookie ${name} has a __Host- or __Secure- prefix`,
      /^__(Host|Secure)-/.test(name),
      "a prefix makes the browser refuse the cookie unless it is Secure (and, for __Host-, host-only on /): hostCookie, ./headers",
      false,
      name,
    );
  }
  if (cookies.length > 0) {
    const cache = headers.get("Cache-Control") ?? "";
    result(
      "X1",
      "a response that sets a cookie is never stored by a shared cache (no-store or private)",
      /(^|,)\s*(no-store|private)\s*(,|$)/i.test(cache),
      `Cache-Control is ${cache ? JSON.stringify(cache) : "ABSENT"}`,
    );
  }
  if (upload) {
    const sandbox = parsePolicy(headers.get("Content-Security-Policy") ?? "").get("sandbox");
    const inert =
      (sandbox !== undefined && !sandbox.some((t) => t.toLowerCase() === "allow-scripts")) ||
      /^\s*attachment/i.test(headers.get("Content-Disposition") ?? "");
    result(
      "A3",
      "an uploaded file is served nosniff",
      (headers.get("X-Content-Type-Options") ?? "").trim().toLowerCase() === "nosniff",
      "a browser may read it as another type (UPLOAD_HEADERS, ./headers)",
    );
    result(
      "A3",
      "an uploaded file runs no script: a sandboxed policy or an attachment",
      inert,
      "opened on its own, the file runs as the site (UPLOAD_HEADERS, ./headers)",
    );
  }
  if (html) {
    // Declared in the entry, these are in the floor and graded above as exactly what buildSecurityHeaders writes.
    const integrityName =
      integrityPolicy === "report-only"
        ? "Integrity-Policy-Report-Only"
        : integrityPolicy
          ? "Integrity-Policy"
          : undefined;
    if (integrityName ? !(integrityName in standard) : entry) {
      const got =
        (integrityName
          ? headers.get(integrityName)
          : (headers.get("Integrity-Policy") ?? headers.get("Integrity-Policy-Report-Only"))) ?? "";
      const label = integrityName ?? "Integrity-Policy (or its Report-Only form)";
      result(
        "S2",
        `${label} blocks scripts without integrity${integrityName ? " (declared: integrityPolicy)" : ""}`,
        /blocked-destinations=\([^)]*\bscript\b[^)]*\)/i.test(got),
        got
          ? `got ${JSON.stringify(got)}`
          : "ABSENT: declare integrityPolicy in the entry (buildSecurityHeaders writes it)",
        false,
        !integrityName,
      );
    }
    if (
      entry &&
      !("Cross-Origin-Embedder-Policy" in standard) &&
      !("Cross-Origin-Embedder-Policy-Report-Only" in standard)
    ) {
      const got =
        headers.get("Cross-Origin-Embedder-Policy") ??
        headers.get("Cross-Origin-Embedder-Policy-Report-Only") ??
        "";
      result(
        "I3",
        "Cross-Origin-Embedder-Policy (or its Report-Only form) is credentialless or require-corp",
        /^\s*(credentialless|require-corp)\s*(;|$)/i.test(got),
        got
          ? `got ${JSON.stringify(got)}`
          : "ABSENT: declare coep in the entry (buildSecurityHeaders writes it)",
        false,
        true,
      );
    }
  }

  if (!csp) return results;
  checkPolicy(headers, result, entry, {
    inlineScripts,
    inlineStyles,
    strictDynamic,
    trustedTypes,
    denyUnlisted,
    cloudflareWebAnalytics,
    framedBySameOrigin,
    baseUriSelf,
    formTargets,
    embeds: optIn("embeds"),
  });
  return results;
}

/**
 * The failed results, warnings and notices left out.
 * @param {CheckResult[]} results
 */
export const failures = (results) => results.filter((r) => !r.pass && !r.warn && !r.notice);
