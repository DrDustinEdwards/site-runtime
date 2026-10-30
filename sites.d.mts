/**
 * The site registry: one entry per live site, holding only its declared deviations from the bar, each with a reason.
 * buildSecurityHeaders({ site }), checkSecurityHeaders(headers, { site }) and the site-runtime-security bin read it.
 */
import type { HeaderOverride } from "./headers.mjs";

/** The builder options a check must accept for a site, each with the reason the site's code gives. */
export type SiteOptIns = {
    cloudflareWebAnalytics?: { value: boolean; reason: string };
    inlineScripts?: { value: "unsafe-inline"; reason: string };
    formTargets?: { value: readonly string[]; reason: string };
    framedBySameOrigin?: { value: boolean; reason: string };
    baseUriSelf?: { value: boolean; reason: string };
    passkey?: { value: boolean; reason: string };
};
export type SiteEntry = {
    id: string;
    origin: string;
    aliases?: readonly string[];
    headers?: Readonly<Record<string, HeaderOverride>>;
    optIns?: SiteOptIns;
};
/** OSHP's Permissions-Policy with each named feature allowed for the site's own pages. */
export function permissionsAllowingSelf(...features: string[]): string;
/** The Permissions-Policy override a site offering passkey sign-in needs: publickey-credentials-get=(self). */
export const PASSKEY_OVERRIDES: Readonly<Record<string, HeaderOverride>>;
export const SITES: readonly SiteEntry[];
/** The entry for an id; an unknown id throws. */
export function siteEntry(id: string): SiteEntry;
/** The entry whose origin or alias is `origin`, or undefined. */
export function siteForOrigin(origin: string): SiteEntry | undefined;
/** PASSKEY_OVERRIDES when the entry opts into passkey, then its own overrides. */
export function siteOverrides(id: string): Record<string, HeaderOverride>;
