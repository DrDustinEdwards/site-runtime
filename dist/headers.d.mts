/**
 * OSHP's Permissions-Policy with each named feature allowed for the site's own pages, from the parsed list rather
 * than a string replace, so a change in OSHP's spelling cannot leave a feature denied without a word.
 * @param {...string} features
 */
export function permissionsAllowingSelf(...features: string[]): string;
/**
 * Cross-Origin-Resource-Policy per response kind. Pages, APIs and anything behind a sign-in keep the standard's
 * `same-origin`; public media and subresources meant to be loaded by other origins (an og:image a link preview shows,
 * a feed a reader fetches, the stylesheet, script or font a sandboxed preview frame loads, whose origin is opaque) are
 * `cross-origin`, so a site marks those responses and not every response. The check accepts `cross-origin` only on
 * these kinds.
 * @param {string | null | undefined} contentType the response's Content-Type
 */
export function corpFor(contentType: string | null | undefined): "same-origin" | "cross-origin";
/**
 * @typedef {{ value: string | null, reason: string }} HeaderOverride
 *   A header a site sends differently from the standard: its own value, or null to send none, and why. A reason is
 *   required, so a deviation is a decision someone wrote down and not an accident.
 */
/**
 * The header overrides a registry entry declares: PASSKEY_OVERRIDES when it opts into passkey, then its own. A
 * Permissions-Policy of its own must still allow the passkey, or the opt-in would be a word with no effect.
 * @param {import("./sites.mjs").ServedSiteEntry} entry
 */
export function entryOverrides({ id, headers, optIns }: import("./sites.mjs").ServedSiteEntry): {
    "Permissions-Policy"?: Readonly<{
        value: string;
        reason: "Passkey sign-in (./sign-in) calls navigator.credentials.get, which OSHP's publickey-credentials-get=() refuses; allowed for the site's own pages only.";
    }> | undefined;
};
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
 * @param {{ site?: import("./sites.mjs").ServedSiteEntry, overrides?: Readonly<Record<string, HeaderOverride>>, coep?: Coep }} [options]
 */
export function buildSecurityHeaders({ site, overrides, coep }?: {
    site?: import("./sites.mjs").ServedSiteEntry;
    overrides?: Readonly<Record<string, HeaderOverride>>;
    coep?: Coep;
}): Record<string, string>;
/** @typedef {{ value: "credentialless" | "require-corp", reportOnly?: boolean }} Coep */
/**
 * A Set-Cookie value for a cookie that holds a sign-in or anything else script must never read (ASVS 3.3.1 to 3.3.4):
 * named `__Host-<name>`, so the browser refuses it unless it is Secure, host-only and on `/`; HttpOnly; and SameSite Lax
 * (or Strict). `maxAge: 0` with an empty value ends it. A name or value a cookie cannot carry is refused, never encoded.
 * A cookie scoped to a `path` other than `/` cannot be `__Host-`, so it is `__Secure-<name>` with the same attributes
 * and no Domain (host-only all the same). Read either back with readCookie.
 * @param {string} name the name without its prefix
 * @param {string} value
 * @param {{ maxAge?: number, sameSite?: "Lax" | "Strict", httpOnly?: boolean, path?: string }} [options]
 *   `httpOnly: false` only for a cookie script must read, which is never a session
 */
export function hostCookie(name: string, value: string, { maxAge, sameSite, httpOnly, path }?: {
    maxAge?: number;
    sameSite?: "Lax" | "Strict";
    httpOnly?: boolean;
    path?: string;
}): string;
/**
 * Every cookie the request carries, as [name, value] in the order sent, both trimmed. A part with no "=" is a value with
 * an empty name (RFC 6265bis 5.6), so it never matches a name and still counts as a cookie.
 * @param {Request} request
 */
export function cookiePairs(request: Request): [string, string][];
/**
 * The value of a cookie hostCookie wrote, by its name without the prefix: `__Host-<name>`, else `__Secure-<name>`.
 * A bare `<name>` is never read, since any sibling subdomain or plaintext page could have set it. The first of a
 * repeated name wins, as browsers send the most specific path first (RFC 6265 5.4). Null when there is none.
 * @param {Request} request
 * @param {string} name
 */
export function readCookie(request: Request, name: string): string | null;
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
 */
export function applyHeaderSet<T extends Headers | Response>(target: T, set?: Readonly<Record<string, string>>, { overwrite }?: {
    overwrite?: boolean;
}): T;
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
 */
export function headersFile(set: Readonly<Record<string, string>>, { paths, comment, charset }?: {
    paths?: Readonly<Record<string, Readonly<Record<string, string>>>>;
    comment?: string | readonly string[];
    charset?: boolean;
}): string;
/**
 * The OSHP recommendations this package does not put in the standard set, and why. Each would break a normal site if
 * sent on every response, or is not one value for every site.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const OWASP_SKIPPED: Readonly<Record<string, string>>;
/**
 * The standard set: OSHP's recommendations minus OWASP_SKIPPED, in OSHP's words.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const STANDARD_SECURITY_HEADERS: Readonly<Record<string, string>>;
/**
 * The headers OSHP recommends for a logout response only (Clear-Site-Data), for a site that has one.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const LOGOUT_HEADERS: Readonly<Record<string, string>>;
/** The override a site that offers passkey sign-in (./sign-in) applies; OSHP's `publickey-credentials-get=()` refuses every passkey. */
export const PASSKEY_OVERRIDES: Readonly<{
    "Permissions-Policy": Readonly<{
        value: string;
        reason: "Passkey sign-in (./sign-in) calls navigator.credentials.get, which OSHP's publickey-credentials-get=() refuses; allowed for the site's own pages only.";
    }>;
}>;
/**
 * What an uploaded file is served with (ASVS 5.4.1): nosniff, so a browser never reads it as another type, and a
 * sandboxed policy that runs no script and loads nothing, so a file opened on its own (an SVG, an HTML file renamed to
 * .png) is inert. Inline styles stay, since an SVG draws with them and they run no code. `./image` sends it on every
 * file it serves; a site's own upload route applies it with applyHeaderSet.
 * @type {Readonly<Record<string, string>>}
 */
export const UPLOAD_HEADERS: Readonly<Record<string, string>>;
/**
 * A header a site sends differently from the standard: its own value, or null to send none, and why. A reason is
 * required, so a deviation is a decision someone wrote down and not an accident.
 */
export type HeaderOverride = {
    value: string | null;
    reason: string;
};
export type Coep = {
    value: "credentialless" | "require-corp";
    reportOnly?: boolean;
};
