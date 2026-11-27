/**
 * @typedef {import("./headers.mjs").HeaderOverride} HeaderOverride
 * @typedef {{
 *   cloudflareWebAnalytics?: { value: boolean | "manual", reason: string },
 *   inlineScripts?: { value: "unsafe-inline", reason: string },
 *   formTargets?: { value: readonly string[], reason: string },
 *   framedBySameOrigin?: { value: boolean, reason: string },
 *   baseUriSelf?: { value: boolean, reason: string },
 *   passkey?: { value: boolean, reason: string },
 *   inlineStyles?: { value: boolean, reason: string },
 *   strictDynamic?: { value: boolean, reason: string },
 *   trustedTypes?: { value: true | "report-only", reason: string },
 *   denyUnlisted?: { value: boolean | "report-only", reason: string },
 *   integrityPolicy?: { value: "enforce" | "report-only", reason: string },
 *   coep?: { value: "credentialless" | "require-corp", reportOnly?: boolean, reason: string },
 *   uploads?: { value: string, reason: string },
 *   embeds?: { value: boolean, reason: string },
 * }} SiteOptIns
 * @typedef {{ reason: string, value?: readonly string[] }} Deviation
 * @typedef {{
 *   skipWorker?: { value: readonly string[], reason: string },
 *   policy?: Omit<import("./csp.mjs").SitePolicy, "reportOnly" | "nonce">,
 *   reportOrigin?: string,
 *   paths?: Readonly<Record<string, Readonly<Record<string, string>>>>,
 * }} SiteAssets
 * @typedef {{
 *   id: string, origin: string, aliases?: readonly string[], oldSite?: { value: string, reason: string },
 *   headers?: Readonly<Record<string, HeaderOverride>>, optIns?: SiteOptIns, deviations?: Readonly<Record<string, Deviation>>,
 *   assets?: SiteAssets, signIn?: SignInProbes,
 * }} SiteEntry
 * @typedef {{ admin?: readonly string[], mcp?: readonly string[] }} SignInProbes
 */
/**
 * The checklist items no site in the family can meet, each with why, reported by the live check as a notice.
 * @type {Readonly<Record<string, string>>}
 */
export const FAMILY_DEVIATIONS: Readonly<Record<string, string>>;
/** @type {SiteEntry} */
export const dustinedwardsInfo: SiteEntry;
/** @type {SiteEntry} */
export const foxhound: SiteEntry;
/** @type {SiteEntry} */
export const foxing: SiteEntry;
/** @type {SiteEntry} */
export const germomics: SiteEntry;
/** @type {SiteEntry} */
export const julieedwardsInfo: SiteEntry;
/** @type {SiteEntry} */
export const bsw: SiteEntry;
/** @type {SiteEntry} */
export const txasm: SiteEntry;
/** @type {SiteEntry} */
export const carrel: SiteEntry;
/** @type {SiteEntry} */
export const carrelDesk: SiteEntry;
/** @type {SiteEntry} */
export const capsidPortal: SiteEntry;
/** @type {SiteEntry} */
export const capsidMcp: SiteEntry;
/** @type {SiteEntry} */
export const carrelMcp: SiteEntry;
/** @type {SiteEntry} */
export const capsid: SiteEntry;
/** @type {SiteEntry} */
export const enarratio: SiteEntry;
/** @type {SiteEntry} */
export const foxhoundMcp: SiteEntry;
/** @type {SiteEntry} */
export const dustinedwardsMcp: SiteEntry;
/** @type {SiteEntry} */
export const foxingMcp: SiteEntry;
/** @type {SiteEntry} */
export const capsomer: SiteEntry;
/** @type {SiteEntry} */
export const prelum: SiteEntry;
/** @type {readonly SiteEntry[]} */
export const SITES: readonly SiteEntry[];
/**
 * `T` with every `reason` key removed, at any depth.
 */
export type WithoutReasons<T> = T extends readonly (infer U)[] ? readonly WithoutReasons<U>[] : T extends object ? { [K in keyof T as K extends "reason" ? never : K]: WithoutReasons<T[K]>; } : T;
/**
 * An entry as `./sites` serves it (sites-values.mjs): SiteEntry without its reasons and deviations (only the check
 * reads those, sites-deviations.mjs).
 */
export type ServedSiteEntry = WithoutReasons<Omit<SiteEntry, "deviations">>;
export type HeaderOverride = import("./headers.mjs").HeaderOverride;
export type SiteOptIns = {
    cloudflareWebAnalytics?: {
        value: boolean | "manual";
        reason: string;
    };
    inlineScripts?: {
        value: "unsafe-inline";
        reason: string;
    };
    formTargets?: {
        value: readonly string[];
        reason: string;
    };
    framedBySameOrigin?: {
        value: boolean;
        reason: string;
    };
    baseUriSelf?: {
        value: boolean;
        reason: string;
    };
    passkey?: {
        value: boolean;
        reason: string;
    };
    inlineStyles?: {
        value: boolean;
        reason: string;
    };
    strictDynamic?: {
        value: boolean;
        reason: string;
    };
    trustedTypes?: {
        value: true | "report-only";
        reason: string;
    };
    denyUnlisted?: {
        value: boolean | "report-only";
        reason: string;
    };
    integrityPolicy?: {
        value: "enforce" | "report-only";
        reason: string;
    };
    coep?: {
        value: "credentialless" | "require-corp";
        reportOnly?: boolean;
        reason: string;
    };
    uploads?: {
        value: string;
        reason: string;
    };
    embeds?: {
        value: boolean;
        reason: string;
    };
};
export type Deviation = {
    reason: string;
    value?: readonly string[];
};
export type SiteAssets = {
    skipWorker?: {
        value: readonly string[];
        reason: string;
    };
    policy?: Omit<import("./csp.mjs").SitePolicy, "reportOnly" | "nonce">;
    reportOrigin?: string;
    paths?: Readonly<Record<string, Readonly<Record<string, string>>>>;
};
export type SiteEntry = {
    id: string;
    origin: string;
    aliases?: readonly string[];
    oldSite?: {
        value: string;
        reason: string;
    };
    headers?: Readonly<Record<string, HeaderOverride>>;
    optIns?: SiteOptIns;
    deviations?: Readonly<Record<string, Deviation>>;
    assets?: SiteAssets;
    signIn?: SignInProbes;
};
export type SignInProbes = {
    admin?: readonly string[];
    mcp?: readonly string[];
};
import { PASSKEY_OVERRIDES } from "./headers.mjs";
import { permissionsAllowingSelf } from "./headers.mjs";
export { PASSKEY_OVERRIDES, permissionsAllowingSelf };
