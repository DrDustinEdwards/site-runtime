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
 * The override a site that offers passkey sign-in (`./sign-in`) passes to buildSecurityHeaders. OSHP's
 * Permissions-Policy sets `publickey-credentials-get=()`, which refuses every passkey sign-in on the page; this allows
 * it for the site's own pages and still for no frame. Every other directive stays OSHP's.
 *
 * @type {Readonly<Record<string, HeaderOverride>>}
 */
export const PASSKEY_OVERRIDES = Object.freeze({
  "Permissions-Policy": Object.freeze({
    value: [
      ...(STANDARD_SECURITY_HEADERS["Permissions-Policy"] ?? "")
        .split(",")
        .map((d) => d.trim())
        .filter((d) => d && !d.startsWith("publickey-credentials-get=")),
      "publickey-credentials-get=(self)",
    ].join(", "),
    reason: "Passkey sign-in (./sign-in) calls navigator.credentials.get, which OSHP's publickey-credentials-get=() refuses; allowed for the site's own pages only.",
  }),
});

/**
 * @typedef {{ value: string | null, reason: string }} HeaderOverride
 *   A header a site sends differently from the standard: its own value, or null to send none, and why. A reason is
 *   required, so a deviation is a decision someone wrote down and not an accident.
 */

/**
 * The set a site sends: the standard with the site's overrides applied. An override must carry a reason and must
 * change something; one that says what the standard already says is refused, so the list stays the list of real
 * deviations.
 *
 * @param {{ overrides?: Readonly<Record<string, HeaderOverride>> }} [site]
 * @returns {Record<string, string>}
 */
export function buildSecurityHeaders({ overrides = {} } = {}) {
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

/**
 * A Cloudflare `_headers` file for the static assets, which the asset server answers without running the Worker, so
 * the Worker's header set never reaches them. `set` (the one the Worker applies) goes on `/*`, minus any
 * Content-Security-Policy; `paths` adds or changes headers on a path pattern (`/assets/*`, `/favicon.svg`). Cloudflare
 * joins a header that two matching rules set, so a path that changes a header of the set first detaches the `/*` value
 * with `! Name`. `comment` lines lead the file, each as `# ...`.
 * @param {Readonly<Record<string, string>>} set
 * @param {{ paths?: Readonly<Record<string, Readonly<Record<string, string>>>>, comment?: string | readonly string[] }} [options]
 * @returns {string}
 */
export function headersFile(set, { paths = {}, comment = [] } = {}) {
  const line = (/** @type {string} */ name, /** @type {string} */ value) => {
    if (/[\r\n:]/.test(name) || /[\r\n]/.test(value)) throw new Error(`header ${JSON.stringify(name)} cannot be written on one line`);
    return `  ${name}: ${value}`;
  };
  const base = Object.entries(set).filter(([name]) => !POLICY_HEADERS.includes(name.toLowerCase()));
  const baseNames = new Set(base.map(([name]) => name.toLowerCase()));
  const notes = (typeof comment === "string" ? comment.split("\n") : comment).map((text) => (text ? `# ${text}` : "#"));
  const blocks = [["/*", ...base.map(([name, value]) => line(name, value))].join("\n")];
  for (const [pattern, headers] of Object.entries(paths)) {
    if (!pattern.startsWith("/") || /\s/.test(pattern)) throw new Error(`${JSON.stringify(pattern)} is not a path pattern`);
    const entries = Object.entries(headers);
    const detach = entries.filter(([name]) => baseNames.has(name.toLowerCase())).map(([name]) => `  ! ${name}`);
    blocks.push([pattern, ...detach, ...entries.map(([name, value]) => line(name, value))].join("\n"));
  }
  return `${notes.map((note) => `${note}\n`).join("")}${blocks.join("\n\n")}\n`;
}
