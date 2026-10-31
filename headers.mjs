/**
 * The standard response header set every site in the portfolio sends, and one way to apply a set.
 *
 * The values are the OWASP Secure Headers Project's own, read by update-owasp.mjs (owasp-headers.mjs says when and
 * from where), for every header that is the same everywhere. Four of OSHP's recommendations are not in the standard,
 * each for a reason that is written down next to it (OWASP_SKIPPED); a site that must differ on another header says
 * so, with a reason, in `overrides`, and the check holds the site to the set it declared.
 *
 * What a site adds on top (a Permissions-Policy of its own, say) is its own and is stated as an override or an
 * extra, never as a copy of this set.
 */

import { OWASP_RECOMMENDED } from "./owasp-headers.mjs";

/**
 * The OSHP recommendations this package does not put in the standard set, and why. Each would break a normal site if
 * sent on every response, or is not one value for every site.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const OWASP_SKIPPED = Object.freeze({
  "Cache-Control": "OSHP's `no-store, max-age=0` on every response makes nothing cacheable, edge caches included; a site sets caching per route.",
  "Clear-Site-Data":
    "On every response it wipes the reader's cookies, storage and cache at each page load, which logs everyone out of everything; OSHP's own suite tests it on the logout page only, so it is exported as LOGOUT_HEADERS for a site's logout response.",
  "Cross-Origin-Embedder-Policy":
    "`require-corp` refuses every cross-origin subresource that does not opt in with Cross-Origin-Resource-Policy or CORS, which breaks images, fonts and scripts a normal site loads from elsewhere; a site turns it on only when it needs cross-origin isolation.",
  "Content-Security-Policy":
    "A policy is not one string for every site: it names what that site loads, so the package builds it from the site's own list (buildContentSecurityPolicy) instead of sharing OSHP's `default-src 'self'` example.",
});

/**
 * The standard set: OSHP's recommendations minus OWASP_SKIPPED, in OSHP's words.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const STANDARD_SECURITY_HEADERS = Object.freeze(
  Object.fromEntries(Object.entries(OWASP_RECOMMENDED).filter(([name]) => !(name in OWASP_SKIPPED))),
);

/**
 * The headers OSHP recommends for a logout response only (Clear-Site-Data), for a site that has one.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const LOGOUT_HEADERS = Object.freeze({ "Clear-Site-Data": OWASP_RECOMMENDED["Clear-Site-Data"] ?? "" });

/**
 * OSHP's Permissions-Policy with each named feature allowed for the site's own pages, from the parsed list rather
 * than a string replace, so a change in OSHP's spelling cannot leave a feature denied without a word.
 * @param {...string} features
 * @returns {string}
 */
export function permissionsAllowingSelf(...features) {
  const directives = (OWASP_RECOMMENDED["Permissions-Policy"] ?? "").split(",").map((d) => d.trim()).filter(Boolean);
  const kept = directives.filter((d) => !features.includes(d.split("=")[0] ?? ""));
  return [...kept, ...features.map((f) => `${f}=(self)`)].join(", ");
}

/** The override a site that offers passkey sign-in (./sign-in) applies; OSHP's `publickey-credentials-get=()` refuses every passkey. */
export const PASSKEY_OVERRIDES = Object.freeze({
  "Permissions-Policy": Object.freeze({
    value: permissionsAllowingSelf("publickey-credentials-get"),
    reason: "Passkey sign-in (./sign-in) calls navigator.credentials.get, which OSHP's publickey-credentials-get=() refuses; allowed for the site's own pages only.",
  }),
});

/**
 * Cross-Origin-Resource-Policy per response kind. Pages, APIs and anything behind a sign-in keep the standard's
 * `same-origin`; public media and subresources meant to be loaded by other origins (an og:image a link preview shows,
 * a feed a reader fetches, the stylesheet, script or font a sandboxed preview frame loads, whose origin is opaque) are
 * `cross-origin`, so a site marks those responses and not every response. The check accepts `cross-origin` only on
 * these kinds.
 * @param {string | null | undefined} contentType the response's Content-Type
 * @returns {"cross-origin" | "same-origin"}
 */
export function corpFor(contentType) {
  return /^\s*(image\/|font\/|text\/css|(text|application)\/javascript|application\/(rss|atom)\+xml|application\/feed\+json)/i.test(contentType ?? "")
    ? "cross-origin"
    : "same-origin";
}

/**
 * @typedef {{ value: string | null, reason: string }} HeaderOverride
 *   A header a site sends differently from the standard: its own value, or null to send none, and why. A reason is
 *   required, so a deviation is a decision someone wrote down and not an accident.
 */

/**
 * The header overrides a registry entry declares: PASSKEY_OVERRIDES when it opts into passkey, then its own. A
 * Permissions-Policy of its own must still allow the passkey, or the opt-in would be a word with no effect.
 * @param {import("./sites.mjs").SiteEntry} entry
 * @returns {Record<string, HeaderOverride>}
 */
export function entryOverrides({ id, headers = {}, optIns = {} }) {
  const merged = { ...(optIns.passkey?.value ? PASSKEY_OVERRIDES : {}), ...headers };
  if (optIns.passkey?.value && !/publickey-credentials-get=\(self\)/.test(merged["Permissions-Policy"]?.value ?? "")) {
    throw new Error(`${id} opts into passkey but its Permissions-Policy refuses publickey-credentials-get`);
  }
  return merged;
}

/**
 * The set a site sends: the standard with the site's overrides applied. An override must carry a reason and must
 * change something; one that says what the standard already says is refused, so the list stays the list of real
 * deviations.
 *
 * `site` is the site's registry entry, imported by name (`import { germomics } from "@dustinedwards/site-runtime/sites"`),
 * whose declared overrides are used; a Worker that imports one entry bundles that entry and not the registry.
 * `overrides` is the older form, for a site not yet built from the registry. Not both.
 *
 * @param {{ site?: import("./sites.mjs").SiteEntry, overrides?: Readonly<Record<string, HeaderOverride>> }} [options]
 * @returns {Record<string, string>}
 */
export function buildSecurityHeaders({ site, overrides } = {}) {
  if (site !== undefined && overrides !== undefined) throw new Error("pass site or overrides, not both: a site's deviations live in its registry entry");
  if (typeof site === "string") throw new Error(`pass the registry entry, not its id: import { ... } from "@dustinedwards/site-runtime/sites" (${site})`);
  overrides = site === undefined ? (overrides ?? {}) : entryOverrides(site);
  /** @type {Record<string, string>} */
  const set = { ...STANDARD_SECURITY_HEADERS };
  for (const [name, { value, reason }] of Object.entries(overrides)) {
    if (typeof reason !== "string" || reason.trim().length < 12) throw new Error(`the override of ${name} gives no reason`);
    if (value === (STANDARD_SECURITY_HEADERS[name] ?? undefined)) throw new Error(`the override of ${name} says what the standard already says`);
    if (value === null) {
      if (!(name in set)) throw new Error(`the override of ${name} removes a header the standard does not send`);
      delete set[name];
    } else if (value.trim() === "") {
      throw new Error(`the override of ${name} is empty; use null to send none`);
    } else {
      set[name] = value;
    }
  }
  return set;
}

/**
 * Stamps a header set onto `headers` in place.
 *
 * `overwrite: true` (the default) makes the set authoritative, which is what dustinedwards.info does on
 * every exit. `overwrite: false` keeps any value a route already chose, which is foxhound's merge. A
 * Response whose headers are immutable (Response.redirect, the Cache API) throws on `set`; rebuild it
 * with `new Response(res.body, { ...res, headers: new Headers(res.headers) })` and apply to that.
 *
 * @param {Headers} headers
 * @param {Readonly<Record<string, string>>} [set]
 * @param {{ overwrite?: boolean }} [options]
 */
export function applyHeaderSet(headers, set = STANDARD_SECURITY_HEADERS, { overwrite = true } = {}) {
  for (const [name, value] of Object.entries(set)) {
    if (overwrite || !headers.has(name)) headers.set(name, value);
  }
}

/** The headers a static `_headers` file leaves out: a page's policy names what that page loads, and may carry a nonce. */
const POLICY_HEADERS = ["content-security-policy", "content-security-policy-report-only"];

/** The static text files whose Content-Type the asset server sends with no charset, by extension. */
export const TEXT_TYPES = Object.freeze({
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  txt: "text/plain",
  xml: "application/xml",
  svg: "image/svg+xml",
});

/**
 * A Cloudflare `_headers` file for the static assets, which the asset server answers without running the Worker, so
 * the Worker's header set never reaches them. `set` (the one the Worker applies) goes on `/*`, minus any
 * Content-Security-Policy; `paths` adds or changes headers on a path pattern (`/assets/*`, `/favicon.svg`). Cloudflare
 * joins a header that two matching rules set, so a path that changes a header of the set first detaches the `/*` value
 * with `! Name`. `comment` lines lead the file, each as `# ...`. `charset: true` adds a Content-Type with
 * `charset=utf-8` for each text extension in TEXT_TYPES, which the asset server otherwise sends without one.
 * @param {Readonly<Record<string, string>>} set
 * @param {{ paths?: Readonly<Record<string, Readonly<Record<string, string>>>>, comment?: string | readonly string[], charset?: boolean }} [options]
 * @returns {string}
 */
export function headersFile(set, { paths = {}, comment = [], charset = false } = {}) {
  const line = (/** @type {string} */ name, /** @type {string} */ value) => {
    if (/[\r\n:]/.test(name) || /[\r\n]/.test(value)) throw new Error(`header ${JSON.stringify(name)} cannot be written on one line`);
    return `  ${name}: ${value}`;
  };
  const base = Object.entries(set).filter(([name]) => !POLICY_HEADERS.includes(name.toLowerCase()));
  const baseNames = new Set(base.map(([name]) => name.toLowerCase()));
  const notes = (typeof comment === "string" ? comment.split("\n") : comment).map((text) => (text ? `# ${text}` : "#"));
  const blocks = [["/*", ...base.map(([name, value]) => line(name, value))].join("\n")];
  const typed = charset ? Object.entries(TEXT_TYPES).map(([ext, type]) => [`/*.${ext}`, { "Content-Type": `${type}; charset=utf-8` }]) : [];
  for (const [pattern, headers] of [...typed, ...Object.entries(paths)]) {
    if (!pattern.startsWith("/") || /\s/.test(pattern)) throw new Error(`${JSON.stringify(pattern)} is not a path pattern`);
    const entries = Object.entries(headers);
    const detach = entries.filter(([name]) => baseNames.has(name.toLowerCase())).map(([name]) => `  ! ${name}`);
    blocks.push([pattern, ...detach, ...entries.map(([name, value]) => line(name, value))].join("\n"));
  }
  return `${notes.map((note) => `${note}\n`).join("")}${blocks.join("\n\n")}\n`;
}
