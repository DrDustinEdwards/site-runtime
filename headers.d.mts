import type { SiteEntry } from "./sites.mjs";

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
 * `site` is the site's registry entry, imported by name from ./sites, whose declared overrides are used; `overrides` is
 * the older form. Not both. `coep` (or the entry's `coep` opt-in) adds Cross-Origin-Embedder-Policy, or its Report-Only
 * form with `reportOnly: true`, with `report-to="csp-endpoint"`. The entry's `integrityPolicy` opt-in adds
 * Integrity-Policy, or its Report-Only form.
 */
export function buildSecurityHeaders(options?: {
    site?: SiteEntry;
    overrides?: Readonly<Record<string, HeaderOverride>>;
    coep?: Coep;
}): Record<string, string>;
/** Cross-Origin-Embedder-Policy: `credentialless` or `require-corp`, Report-Only when asked. */
export type Coep = { value: "credentialless" | "require-corp"; reportOnly?: boolean };
/**
 * A Set-Cookie value: `__Host-<name>=<value>; Path=/; Secure; HttpOnly; SameSite=Lax`, with Max-Age when given. A name
 * with a prefix already, or a name or value a cookie cannot carry, is refused.
 */
export function hostCookie(name: string, value: string, options?: { maxAge?: number; sameSite?: "Lax" | "Strict"; httpOnly?: boolean }): string;
/** What an uploaded file is served with: nosniff and `sandbox; default-src 'none'; style-src 'unsafe-inline'`. */
export const UPLOAD_HEADERS: Readonly<Record<string, string>>;
/**
 * Stamps a header set onto a Headers in place, or onto a Response, which comes back rebuilt with it (immutable headers
 * included). A WebSocket upgrade (101, or a Response with its `webSocket`) comes back as it is. `overwrite: false` keeps
 * any value a route already chose. A text or XML Content-Type with no charset gains `charset=utf-8`.
 */
export function applyHeaderSet<T extends Headers | Response>(target: T, set?: Readonly<Record<string, string>>, options?: {
    overwrite?: boolean;
}): T;
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
/** OSHP's Permissions-Policy with each named feature allowed for the site's own pages. */
export function permissionsAllowingSelf(...features: string[]): string;
/** The Permissions-Policy override a site offering passkey sign-in needs: publickey-credentials-get=(self). */
export const PASSKEY_OVERRIDES: Readonly<Record<string, HeaderOverride>>;
/** PASSKEY_OVERRIDES when the entry opts into passkey, then its own overrides. */
export function entryOverrides(entry: SiteEntry): Record<string, HeaderOverride>;
/** `cross-origin` for public media and subresources other origins load (images, fonts, CSS, scripts, feeds), else `same-origin`. */
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
 * `charset: true` adds a `/*.<ext>` rule per static type: `charset=utf-8` on text, and corpFor's CORP, so stylesheets,
 * scripts, SVG and fonts are `cross-origin`. A `paths` entry for one of those patterns is merged into its rule; a header a `/*` rule of `paths` adds is detached
 * the same way on a path that sets its own.
 */
export function headersFile(
  set: Readonly<Record<string, string>>,
  options?: { paths?: Readonly<Record<string, Readonly<Record<string, string>>>>; comment?: string | readonly string[]; charset?: boolean },
): string;
