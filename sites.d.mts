/**
 * The site registry: one entry per live site, holding only its declared deviations from the bar, each with a reason.
 * buildSecurityHeaders({ site: entry }), checkSecurityHeaders(headers, { site }) and the site-runtime-security bin read it.
 */
import type { HeaderOverride } from "./headers.mjs";
import type { SitePolicy } from "./csp.mjs";

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
    /** Held to its declared form: 'strict-dynamic' with a nonce or hash (C3, graded on every site). */
    strictDynamic?: { value: boolean; reason: string };
    /** Held to its declared form: require-trusted-types-for 'script', enforced (true) or in the Report-Only policy (C7). */
    trustedTypes?: { value: true | "report-only"; reason: string };
    /** Held to its declared form: default-src 'none', enforced (true) or in the Report-Only policy (C9). */
    denyUnlisted?: { value: boolean | "report-only"; reason: string };
    /** Integrity-Policy, or its Report-Only form, which buildSecurityHeaders writes (S2). */
    integrityPolicy?: { value: "enforce" | "report-only"; reason: string };
    /** Cross-Origin-Embedder-Policy, which buildSecurityHeaders writes and the check grades (I3). */
    coep?: { value: "credentialless" | "require-corp"; reportOnly?: boolean; reason: string };
    /** The path prefix the site serves uploaded files under, which the live check samples (A3). */
    uploads?: { value: string; reason: string };
};
/** A checklist item the site declines, with why; `value` names the cookies a K1 deviation covers. */
export type Deviation = { reason: string; value?: readonly string[] };
/** How the static files reach a reader without the Worker, and what site-runtime-headers writes for them. */
export type SiteAssets = {
    /** The patterns run_worker_first leaves to the asset server, which take the set from _headers alone. */
    skipWorker?: { value: readonly string[]; reason: string };
    /** A static site's one page policy: buildContentSecurityPolicy's options beside the policy opt-ins. */
    policy?: Omit<SitePolicy, "reportOnly" | "nonce">;
    /** Where that policy reports, when not the site's own origin. */
    reportOrigin?: string;
    /** The headers a path pattern adds (a cache rule, CORP). */
    paths?: Readonly<Record<string, Readonly<Record<string, string>>>>;
};
export type SiteEntry = {
    id: string;
    origin: string;
    aliases?: readonly string[];
    /** The real domain while it still serves the live old site: the workers.dev host is noindexed until then (A6). */
    oldSite?: { value: string; reason: string };
    headers?: Readonly<Record<string, HeaderOverride>>;
    optIns?: SiteOptIns;
    /** Items the site does not meet (S2, C3, C7, C9, I3, K1's cookie prefix), by id: reported as warnings, not errors. */
    deviations?: Readonly<Record<string, Deviation>>;
    assets?: SiteAssets;
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
