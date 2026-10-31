/**
 * The site registry: one entry per live site, holding only its declared deviations from the bar, each with a reason.
 * buildSecurityHeaders({ site: entry }), checkSecurityHeaders(headers, { site }) and the site-runtime-security bin read it.
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
    /** 'unsafe-inline' on style-src (C11). */
    inlineStyles?: { value: boolean; reason: string };
    /** Graded when declared: 'strict-dynamic' with a nonce or hash (C3). */
    strictDynamic?: { value: boolean; reason: string };
    /** Graded when declared: require-trusted-types-for 'script', enforced (true) or in the Report-Only policy (C7). */
    trustedTypes?: { value: true | "report-only"; reason: string };
    /** Graded when declared: default-src 'none' (C9). */
    denyUnlisted?: { value: boolean; reason: string };
    /** Graded when declared: Integrity-Policy, or its Report-Only form, blocking scripts (S2). */
    integrityPolicy?: { value: "enforce" | "report-only"; reason: string };
    /** Cross-Origin-Embedder-Policy, which buildSecurityHeaders writes and the check grades (I3). */
    coep?: { value: "credentialless" | "require-corp"; reportOnly?: boolean; reason: string };
    /** The path prefix the site serves uploaded files under, which the live check samples (A3). */
    uploads?: { value: string; reason: string };
};
/** A checklist item the site declines, with why; `value` names the cookies a K1 deviation covers. */
export type Deviation = { reason: string; value?: readonly string[] };
export type SiteEntry = {
    id: string;
    origin: string;
    aliases?: readonly string[];
    headers?: Readonly<Record<string, HeaderOverride>>;
    optIns?: SiteOptIns;
    /** Items a check marks as declinable (K1's cookie prefix, A6), by id: reported as warnings, not errors. */
    deviations?: Readonly<Record<string, Deviation>>;
};
/** The checklist items no family site can meet, by id, with why; the live check reports each as a notice. */
export const FAMILY_DEVIATIONS: Readonly<Record<string, string>>;
export { PASSKEY_OVERRIDES, permissionsAllowingSelf } from "./headers.mjs";
/** One export per entry, so a Worker bundles only its own. */
export const dustinedwardsInfo: SiteEntry, foxhound: SiteEntry, foxing: SiteEntry, germomics: SiteEntry, julieedwardsInfo: SiteEntry,
    bsw: SiteEntry, txasm: SiteEntry, carrel: SiteEntry, carrelDesk: SiteEntry, capsidPortal: SiteEntry, capsidMcp: SiteEntry, carrelMcp: SiteEntry,
    capsid: SiteEntry, enarratio: SiteEntry, foxhoundMcp: SiteEntry, dustinedwardsMcp: SiteEntry, foxingMcp: SiteEntry, capsomer: SiteEntry, prelum: SiteEntry;
export const SITES: readonly SiteEntry[];
/** The entry for an id; an unknown id throws. */
export function siteEntry(id: string): SiteEntry;
/** The entry whose origin or alias is `origin`, or undefined. */
export function siteForOrigin(origin: string): SiteEntry | undefined;
/** PASSKEY_OVERRIDES when the entry opts into passkey, then its own overrides. */
export function siteOverrides(id: string): Record<string, HeaderOverride>;
