/** The entry for an id; unknown ids throw. @param {string} id */
export function siteEntry(id: string): {
    id: string;
    headers?: {
        readonly [x: string]: {
            value: string | null;
        };
    } | undefined;
    origin: string;
    aliases?: readonly string[] | undefined;
    oldSite?: {
        value: string;
    } | undefined;
    optIns?: {
        cloudflareWebAnalytics?: {
            value: boolean | "manual";
        } | undefined;
        inlineScripts?: {
            value: "unsafe-inline";
        } | undefined;
        formTargets?: {
            value: readonly string[];
        } | undefined;
        framedBySameOrigin?: {
            value: boolean;
        } | undefined;
        baseUriSelf?: {
            value: boolean;
        } | undefined;
        passkey?: {
            value: boolean;
        } | undefined;
        inlineStyles?: {
            value: boolean;
        } | undefined;
        strictDynamic?: {
            value: boolean;
        } | undefined;
        trustedTypes?: {
            value: true | "report-only";
        } | undefined;
        denyUnlisted?: {
            value: boolean | "report-only";
        } | undefined;
        integrityPolicy?: {
            value: "enforce" | "report-only";
        } | undefined;
        coep?: {
            value: "credentialless" | "require-corp";
            reportOnly?: boolean | undefined;
        } | undefined;
        uploads?: {
            value: string;
        } | undefined;
        embeds?: {
            value: boolean;
        } | undefined;
    } | undefined;
    assets?: {
        skipWorker?: {
            value: readonly string[];
        } | undefined;
        policy?: {
            sources?: {
                script?: readonly string[] | undefined;
                style?: readonly string[] | undefined;
                img?: readonly string[] | undefined;
                font?: readonly string[] | undefined;
                connect?: readonly string[] | undefined;
                frame?: readonly string[] | undefined;
                media?: readonly string[] | undefined;
            } | undefined;
            scriptHashes?: readonly string[] | undefined;
            styleHashes?: readonly string[] | undefined;
            nonceStyles?: boolean | undefined;
            inlineScripts?: "unsafe-inline" | undefined;
            strictDynamic?: boolean | undefined;
            styleAttributesInline?: boolean | undefined;
            cloudflareWebAnalytics?: boolean | "manual" | undefined;
            reportUri?: string | undefined;
            reportTo?: string | undefined;
            framedBySameOrigin?: boolean | undefined;
            embeds?: boolean | undefined;
            baseUriSelf?: boolean | undefined;
            denyUnlisted?: boolean | undefined;
            noForms?: boolean | undefined;
            formTargets?: readonly string[] | undefined;
            trustedTypes?: (true | readonly string[]) | undefined;
            extraDirectives?: readonly string[] | undefined;
        } | undefined;
        reportOrigin?: string | undefined;
        paths?: {
            readonly [x: string]: {
                readonly [x: string]: string;
            };
        } | undefined;
    } | undefined;
    signIn?: {
        admin?: readonly string[] | undefined;
        mcp?: readonly string[] | undefined;
    } | undefined;
};
/** The entry whose origin or alias is `origin`, or undefined. @param {string} origin */
export function siteForOrigin(origin: string): {
    id: string;
    headers?: {
        readonly [x: string]: {
            value: string | null;
        };
    } | undefined;
    origin: string;
    aliases?: readonly string[] | undefined;
    oldSite?: {
        value: string;
    } | undefined;
    optIns?: {
        cloudflareWebAnalytics?: {
            value: boolean | "manual";
        } | undefined;
        inlineScripts?: {
            value: "unsafe-inline";
        } | undefined;
        formTargets?: {
            value: readonly string[];
        } | undefined;
        framedBySameOrigin?: {
            value: boolean;
        } | undefined;
        baseUriSelf?: {
            value: boolean;
        } | undefined;
        passkey?: {
            value: boolean;
        } | undefined;
        inlineStyles?: {
            value: boolean;
        } | undefined;
        strictDynamic?: {
            value: boolean;
        } | undefined;
        trustedTypes?: {
            value: true | "report-only";
        } | undefined;
        denyUnlisted?: {
            value: boolean | "report-only";
        } | undefined;
        integrityPolicy?: {
            value: "enforce" | "report-only";
        } | undefined;
        coep?: {
            value: "credentialless" | "require-corp";
            reportOnly?: boolean | undefined;
        } | undefined;
        uploads?: {
            value: string;
        } | undefined;
        embeds?: {
            value: boolean;
        } | undefined;
    } | undefined;
    assets?: {
        skipWorker?: {
            value: readonly string[];
        } | undefined;
        policy?: {
            sources?: {
                script?: readonly string[] | undefined;
                style?: readonly string[] | undefined;
                img?: readonly string[] | undefined;
                font?: readonly string[] | undefined;
                connect?: readonly string[] | undefined;
                frame?: readonly string[] | undefined;
                media?: readonly string[] | undefined;
            } | undefined;
            scriptHashes?: readonly string[] | undefined;
            styleHashes?: readonly string[] | undefined;
            nonceStyles?: boolean | undefined;
            inlineScripts?: "unsafe-inline" | undefined;
            strictDynamic?: boolean | undefined;
            styleAttributesInline?: boolean | undefined;
            cloudflareWebAnalytics?: boolean | "manual" | undefined;
            reportUri?: string | undefined;
            reportTo?: string | undefined;
            framedBySameOrigin?: boolean | undefined;
            embeds?: boolean | undefined;
            baseUriSelf?: boolean | undefined;
            denyUnlisted?: boolean | undefined;
            noForms?: boolean | undefined;
            formTargets?: readonly string[] | undefined;
            trustedTypes?: (true | readonly string[]) | undefined;
            extraDirectives?: readonly string[] | undefined;
        } | undefined;
        reportOrigin?: string | undefined;
        paths?: {
            readonly [x: string]: {
                readonly [x: string]: string;
            };
        } | undefined;
    } | undefined;
    signIn?: {
        admin?: readonly string[] | undefined;
        mcp?: readonly string[] | undefined;
    } | undefined;
} | undefined;
/** The header overrides an entry declares (entryOverrides, ./headers), by id. @param {string} id */
export function siteOverrides(id: string): Record<string, import("./headers.mjs").HeaderOverride>;
/** @type {ServedSiteEntry} */
export const bsw: ServedSiteEntry;
/** @type {ServedSiteEntry} */
export const capsid: ServedSiteEntry;
/** @type {ServedSiteEntry} */
export const capsidMcp: ServedSiteEntry;
/** @type {ServedSiteEntry} */
export const capsidPortal: ServedSiteEntry;
/** @type {ServedSiteEntry} */
export const capsomer: ServedSiteEntry;
/** @type {ServedSiteEntry} */
export const carrel: ServedSiteEntry;
/** @type {ServedSiteEntry} */
export const carrelDesk: ServedSiteEntry;
/** @type {ServedSiteEntry} */
export const carrelMcp: ServedSiteEntry;
/** @type {ServedSiteEntry} */
export const dustinedwardsInfo: ServedSiteEntry;
/** @type {ServedSiteEntry} */
export const dustinedwardsMcp: ServedSiteEntry;
/** @type {ServedSiteEntry} */
export const enarratio: ServedSiteEntry;
/** @type {ServedSiteEntry} */
export const foxhound: ServedSiteEntry;
/** @type {ServedSiteEntry} */
export const foxhoundMcp: ServedSiteEntry;
/** @type {ServedSiteEntry} */
export const foxing: ServedSiteEntry;
/** @type {ServedSiteEntry} */
export const foxingMcp: ServedSiteEntry;
/** @type {ServedSiteEntry} */
export const germomics: ServedSiteEntry;
/** @type {ServedSiteEntry} */
export const julieedwardsInfo: ServedSiteEntry;
/** @type {ServedSiteEntry} */
export const prelum: ServedSiteEntry;
/** @type {ServedSiteEntry} */
export const txasm: ServedSiteEntry;
/** @type {readonly ServedSiteEntry[]} */
export const SITES: readonly ServedSiteEntry[];
export type ServedSiteEntry = import("./sites.mjs").ServedSiteEntry;
export type SignInProbes = import("./sites.mjs").SignInProbes;
export type SiteAssets = import("./sites.mjs").SiteAssets;
export type SiteOptIns = import("./sites.mjs").SiteOptIns;
export { PASSKEY_OVERRIDES, permissionsAllowingSelf } from "./headers.mjs";
