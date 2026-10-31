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
 * `site` is an id in the registry (./sites), whose declared overrides are used; `overrides` is the older form. Not both.
 */
export function buildSecurityHeaders(options?: {
    site?: string;
    overrides?: Readonly<Record<string, HeaderOverride>>;
}): Record<string, string>;
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
export function applyHeaderSet(headers: Headers, set?: Readonly<Record<string, string>>, { overwrite }?: {
    overwrite?: boolean;
}): void;
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
/** The Permissions-Policy override a site offering passkey sign-in needs: publickey-credentials-get=(self). */
export { PASSKEY_OVERRIDES } from "./sites.mjs";
/** `cross-origin` for public media other origins load (images, RSS, Atom and JSON feeds), else `same-origin`. */
export function corpFor(contentType: string | null | undefined): "cross-origin" | "same-origin";
/**
 * A header a site sends differently from the standard: its own value, or null to send none, and why. A reason is
 * required, so a deviation is a decision someone wrote down and not an accident.
 */
export type HeaderOverride = {
    value: string | null;
    reason: string;
};

/**
 * A Cloudflare `_headers` file for static assets: `set` on `/*` minus any Content-Security-Policy, then each of `paths`
 * (pattern to headers), detaching with `! Name` a header the `/*` block already sets. `comment` lines lead as `# ...`.
 */
export function headersFile(
  set: Readonly<Record<string, string>>,
  options?: { paths?: Readonly<Record<string, Readonly<Record<string, string>>>>; comment?: string | readonly string[] },
): string;
