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

import { CSP_REPORT_GROUP, integrityPolicy } from "./csp.mjs";
import { permissionsAllowingEmbeds } from "./embeds.mjs";
import { OWASP_RECOMMENDED } from "./owasp-headers.mjs";

/**
 * The OSHP recommendations this package does not put in the standard set, and why. Each would break a normal site if
 * sent on every response, or is not one value for every site.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const OWASP_SKIPPED = /* @__PURE__ */ Object.freeze({
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
export const LOGOUT_HEADERS = /* @__PURE__ */ Object.freeze({ "Clear-Site-Data": OWASP_RECOMMENDED["Clear-Site-Data"] ?? "" });

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
export const PASSKEY_OVERRIDES = /* @__PURE__ */ Object.freeze({
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
 * `coep` turns on Cross-Origin-Embedder-Policy, which the standard leaves out (OWASP_SKIPPED): `credentialless` loads a
 * cross-origin subresource without its cookies, `require-corp` refuses one that does not opt in. `reportOnly: true`
 * sends Cross-Origin-Embedder-Policy-Report-Only instead, the way to start. Either names the family's report group
 * (`report-to="csp-endpoint"`), so what it refuses, or would refuse, reaches the sink (./csp-report). A registry entry
 * declares it as its `coep` opt-in, which the check then grades; passed here it is for a site not built from the
 * registry. An entry's `embeds` opt-in (./embeds) allows the players' features in its Permissions-Policy and refuses an
 * enforced coep beside it. An entry's `integrityPolicy` opt-in adds Integrity-Policy, or its Report-Only form (integrityPolicy,
 * ./csp), reporting to the same group.
 *
 * @param {{ site?: import("./sites.mjs").SiteEntry, overrides?: Readonly<Record<string, HeaderOverride>>, coep?: Coep }} [options]
 * @returns {Record<string, string>}
 */
export function buildSecurityHeaders({ site, overrides, coep } = {}) {
  if (site !== undefined && overrides !== undefined) throw new Error("pass site or overrides, not both: a site's deviations live in its registry entry");
  if (typeof site === "string") throw new Error(`pass the registry entry, not its id: import { ... } from "@dustinedwards/site-runtime/sites" (${site})`);
  overrides = site === undefined ? (overrides ?? {}) : entryOverrides(site);
  /** @type {Record<string, string>} */
  const set = { ...STANDARD_SECURITY_HEADERS };
  for (const [name, { value, reason }] of Object.entries(overrides)) {
    // A registry entry's reasons are kept out of a Worker's bundle (sites-reasons.mjs); the registry's own test holds them.
    if (site === undefined && (typeof reason !== "string" || reason.trim().length < 12)) throw new Error(`the override of ${name} gives no reason`);
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
  // A post's players (./embeds): their features in the Permissions-Policy, and no enforced COEP, which refuses a
  // player because none sends one.
  if (site?.optIns?.embeds?.value) {
    set["Permissions-Policy"] = permissionsAllowingEmbeds(set["Permissions-Policy"] ?? "");
    if (site.optIns.coep && !site.optIns.coep.reportOnly) throw new Error(`${site.id} embeds players, which send no Cross-Origin-Embedder-Policy, so an enforced coep refuses them; keep it reportOnly`);
  }
  const embedder = coep ?? site?.optIns?.coep;
  if (embedder) {
    if (embedder.value !== "credentialless" && embedder.value !== "require-corp") throw new Error(`coep is "credentialless" or "require-corp", not ${JSON.stringify(embedder.value)}`);
    set[embedder.reportOnly ? "Cross-Origin-Embedder-Policy-Report-Only" : "Cross-Origin-Embedder-Policy"] = `${embedder.value}; report-to="${CSP_REPORT_GROUP}"`;
  }
  const integrity = site?.optIns?.integrityPolicy?.value;
  if (integrity) {
    if (integrity !== "enforce" && integrity !== "report-only") throw new Error(`integrityPolicy is "enforce" or "report-only", not ${JSON.stringify(integrity)}`);
    const { name, value } = integrityPolicy({ reportOnly: integrity === "report-only" });
    set[name] = value;
  }
  return set;
}

/** @typedef {{ value: "credentialless" | "require-corp", reportOnly?: boolean }} Coep */

/**
 * A Set-Cookie value for a cookie that holds a sign-in or anything else script must never read (ASVS 3.3.1 to 3.3.4):
 * named `__Host-<name>`, so the browser refuses it unless it is Secure, host-only and on `/`; HttpOnly; and SameSite Lax
 * (or Strict). `maxAge: 0` with an empty value ends it. A name or value a cookie cannot carry is refused, never encoded.
 * @param {string} name the name without its prefix
 * @param {string} value
 * @param {{ maxAge?: number, sameSite?: "Lax" | "Strict", httpOnly?: boolean }} [options] `httpOnly: false` only for a
 *   cookie script must read, which is never a session
 * @returns {string}
 */
export function hostCookie(name, value, { maxAge, sameSite = "Lax", httpOnly = true } = {}) {
  if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name) || /^__(host|secure)-/i.test(name)) throw new Error(`${JSON.stringify(name)} is not a cookie name (give it without its prefix)`);
  if (!/^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/.test(value)) throw new Error(`the value of cookie ${name} holds a character a cookie cannot carry`);
  if (sameSite !== "Lax" && sameSite !== "Strict") throw new Error(`SameSite is Lax or Strict, not ${JSON.stringify(sameSite)}`);
  if (maxAge !== undefined && !(Number.isInteger(maxAge) && maxAge >= 0)) throw new Error(`maxAge is whole seconds, got ${maxAge}`);
  return [`__Host-${name}=${value}`, "Path=/", "Secure", ...(httpOnly ? ["HttpOnly"] : []), `SameSite=${sameSite}`, ...(maxAge === undefined ? [] : [`Max-Age=${maxAge}`])].join("; ");
}

/**
 * What an uploaded file is served with (ASVS 5.4.1): nosniff, so a browser never reads it as another type, and a
 * sandboxed policy that runs no script and loads nothing, so a file opened on its own (an SVG, an HTML file renamed to
 * .png) is inert. Inline styles stay, since an SVG draws with them and they run no code. `./image` sends it on every
 * file it serves; a site's own upload route applies it with applyHeaderSet.
 * @type {Readonly<Record<string, string>>}
 */
export const UPLOAD_HEADERS = /* @__PURE__ */ Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
});

/**
 * Stamps a header set onto `target`: a Headers in place, or a Response, which comes back rebuilt with the set (so a
 * Response whose headers are immutable, such as Response.redirect's or the Cache API's, still takes it, its body
 * streaming through untouched). A WebSocket upgrade (101, or a Response carrying its `webSocket`) is the socket
 * itself and carries no document, so it comes back as it is: rebuilding it would drop the socket.
 *
 * `overwrite: true` (the default) makes the set authoritative, which is what dustinedwards.info does on
 * every exit. `overwrite: false` keeps any value a route already chose, which is foxhound's merge. Headers that are
 * immutable throw on `set`; pass the Response instead. A text or XML Content-Type with no charset (React Router's
 * `text/html`, say) gains `charset=utf-8`, as ASVS 4.1.1 asks.
 *
 * @template {Headers | Response} T
 * @param {T} target
 * @param {Readonly<Record<string, string>>} [set]
 * @param {{ overwrite?: boolean }} [options]
 * @returns {T}
 */
export function applyHeaderSet(target, set = STANDARD_SECURITY_HEADERS, { overwrite = true } = {}) {
  if (target instanceof Response) {
    if (target.status === 101 || /** @type {Response & { webSocket?: unknown }} */ (target).webSocket) return target;
    const headers = new Headers(target.headers);
    applyHeaderSet(headers, set, { overwrite });
    return /** @type {T} */ (new Response(target.body, { status: target.status, statusText: target.statusText, headers }));
  }
  const headers = /** @type {Headers} */ (target);
  for (const [name, value] of Object.entries(set)) {
    if (overwrite || !headers.has(name)) headers.set(name, value);
  }
  const type = headers.get("Content-Type");
  if (type && /^\s*(text\/|[^;]*[/+]xml\s*$)/i.test(type) && !/;/.test(type)) headers.set("Content-Type", `${type.trim()}; charset=utf-8`);
  return target;
}

/** The headers a static `_headers` file leaves out: a page's policy names what that page loads, and may carry a nonce. */
const POLICY_HEADERS = ["content-security-policy", "content-security-policy-report-only"];

/** The static files whose headers the asset server gets wrong, by extension: text with no charset, and fonts with the standard's same-origin CORP. */
const STATIC_TYPES = /* @__PURE__ */ Object.freeze({
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  txt: "text/plain",
  xml: "application/xml",
  svg: "image/svg+xml",
  woff2: "font/woff2",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  ico: "image/x-icon",
});
/** The types the asset server sends without a charset that need one: text, and SVG, which is XML. */
const NEEDS_CHARSET = /^(text\/|application\/xml$|image\/svg\+xml$)/;

/**
 * A Cloudflare `_headers` file for the static assets, which the asset server answers without running the Worker, so
 * the Worker's header set never reaches them. `set` (the one the Worker applies) goes on `/*`, minus any
 * Content-Security-Policy; `paths` adds or changes headers on a path pattern (`/assets/*`, `/favicon.svg`). Cloudflare
 * joins a header that two matching rules set, so a path that changes a header of the set first detaches the `/*` value
 * with `! Name`, as does a path that changes a header a `/*` rule of `paths` adds. `comment` lines lead the file, each as `# ...`. `charset: true` adds a rule per static extension:
 * `charset=utf-8` on each text type, which the asset server otherwise leaves off, and the Cross-Origin-Resource-Policy
 * corpFor gives its type, so stylesheets, scripts, images and fonts are `cross-origin` (another origin, or a sandboxed
 * frame's opaque one, may load them: a link preview loads a share card, a reader shows a feed's pictures) and nothing
 * else is. A `paths` entry for one of those patterns is merged into its
 * rule, its own values winning.
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
  const baseCorp = base.find(([name]) => name.toLowerCase() === "cross-origin-resource-policy")?.[1];
  const notes = (typeof comment === "string" ? comment.split("\n") : comment).map((text) => (text ? `# ${text}` : "#"));
  /** @type {Map<string, Record<string, string>>} */
  const rules = new Map();
  if (charset) {
    for (const [ext, type] of Object.entries(STATIC_TYPES)) {
      const corp = corpFor(type);
      rules.set(`/*.${ext}`, {
        ...(NEEDS_CHARSET.test(type) ? { "Content-Type": `${type}; charset=utf-8` } : {}),
        ...(baseCorp && corp !== baseCorp ? { "Cross-Origin-Resource-Policy": corp } : {}),
      });
    }
    // A folder's index page is answered at `/` or a path ending in `/`, with no extension for a `/*.html` rule to match.
    for (const pattern of ["/", "/*/"]) rules.set(pattern, { "Content-Type": "text/html; charset=utf-8" });
  }
  for (const [pattern, headers] of Object.entries(paths)) rules.set(pattern, { ...rules.get(pattern), ...headers });
  // A header a `/*` rule of `paths` adds (a static site's one page policy) is detached the same way on a path that sets its own.
  const starNames = new Set(Object.keys(paths["/*"] ?? {}).map((name) => name.toLowerCase()));
  const blocks = [["/*", ...base.map(([name, value]) => line(name, value))].join("\n")];
  for (const [pattern, headers] of rules) {
    if (!pattern.startsWith("/") || /\s/.test(pattern)) throw new Error(`${JSON.stringify(pattern)} is not a path pattern`);
    const entries = Object.entries(headers);
    if (entries.length === 0) continue;
    const detach = entries.filter(([name]) => baseNames.has(name.toLowerCase()) || (pattern !== "/*" && starNames.has(name.toLowerCase()))).map(([name]) => `  ! ${name}`);
    blocks.push([pattern, ...detach, ...entries.map(([name, value]) => line(name, value))].join("\n"));
  }
  return `${notes.map((note) => `${note}\n`).join("")}${blocks.join("\n\n")}\n`;
}
