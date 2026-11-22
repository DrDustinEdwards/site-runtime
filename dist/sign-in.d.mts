/**
 * @typedef {(data: { email: string, url: string, token: string, code: string }, ctx?: unknown) => Promise<void> | void} SendMagicLink
 * @typedef {(data: { email: string, code: string }, ctx?: unknown) => Promise<void> | void} SendSignInCode
 * @typedef {import("./sign-in-account.mjs").SendSecurityNotice} SendSecurityNotice
 */
/**
 * The Turnstile site key when the check on the email link is on, else null (the form then shows no widget).
 * @param {{ TURNSTILE_SITE_KEY?: string, TURNSTILE_SECRET_KEY?: string }} env
 */
export function turnstileSiteKey(env: {
    TURNSTILE_SITE_KEY?: string;
    TURNSTILE_SECRET_KEY?: string;
}): string | null;
/**
 * @param {{
 *   BETTER_AUTH_URL: string,
 *   TURNSTILE_SITE_KEY?: string, TURNSTILE_SECRET_KEY?: string,
 *   GOOGLE_CLIENT_ID?: string, GOOGLE_CLIENT_SECRET?: string,
 *   APPLE_CLIENT_ID?: string, APPLE_TEAM_ID?: string, APPLE_KEY_ID?: string, APPLE_PRIVATE_KEY?: string,
 * }} env
 * @param {{
 *   siteName: string, sendMagicLink: SendMagicLink, social?: boolean, appCode?: boolean, sendSignInCode?: SendSignInCode,
 *   confirmPath?: string, emailLimiter?: Parameters<typeof limit>[0], sendSecurityNotice?: SendSecurityNotice,
 *   eventsDb?: import("./sign-in-account.mjs").D1Like, turnstile?: typeof TURNSTILE_OFF_UNTIL_KEYS,
 *   sessionDetails?: boolean, turnstileHostnames?: string[],
 * }} site
 * @returns {Promise<{ emailAndPassword: { enabled: false }; plugins: [ ReturnType<typeof magicLink>, ReturnType<typeof emailOTP>, ReturnType<typeof passkey>, ...BetterAuthPlugin[], ]; disabledPaths: string[]; socialProviders: { google?: { clientId: string; clientSecret: string; mapProfileToUser: (profile: { email?: unknown }) => Promise<Record<string, never>> }; apple?: { clientId: string; clientSecret: string; mapProfileToUser: (profile: { email?: unknown }) => Promise<Record<string, never>> } }; account: { accountLinking: { enabled: true; disableImplicitLinking: true } }; session: { expiresIn: typeof SESSION_SECONDS; disableSessionRefresh: true; freshAge: typeof FRESH_SECONDS; additionalFields?: { location: { type: "string"; required: false; input: false }; deviceId: { type: "string"; required: false; input: false; returned: false } } }; databaseHooks?: { account: { create: NoOAuthTokensHook; update: NoOAuthTokensHook } }; rateLimit: { enabled: true; storage: "database"; customRules?: Record<string, { window: number; max: number }> }; advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } }; trustedOrigins: string[] }>}
 */
export function signInOptions(env: {
    BETTER_AUTH_URL: string;
    TURNSTILE_SITE_KEY?: string;
    TURNSTILE_SECRET_KEY?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    APPLE_CLIENT_ID?: string;
    APPLE_TEAM_ID?: string;
    APPLE_KEY_ID?: string;
    APPLE_PRIVATE_KEY?: string;
}, { siteName, sendMagicLink, social, appCode, sendSignInCode, confirmPath, emailLimiter, sendSecurityNotice, eventsDb, turnstile, sessionDetails, turnstileHostnames, }: {
    siteName: string;
    sendMagicLink: SendMagicLink;
    social?: boolean;
    appCode?: boolean;
    sendSignInCode?: SendSignInCode;
    confirmPath?: string;
    emailLimiter?: Parameters<typeof limit>[0];
    sendSecurityNotice?: SendSecurityNotice;
    eventsDb?: import("./sign-in-account.mjs").D1Like;
    turnstile?: typeof TURNSTILE_OFF_UNTIL_KEYS;
    sessionDetails?: boolean;
    turnstileHostnames?: string[];
}): Promise<{
    emailAndPassword: {
        enabled: false;
    };
    plugins: [ReturnType<typeof magicLink>, ReturnType<typeof emailOTP>, ReturnType<typeof passkey>, ...BetterAuthPlugin[]];
    disabledPaths: string[];
    socialProviders: {
        google?: {
            clientId: string;
            clientSecret: string;
            mapProfileToUser: (profile: {
                email?: unknown;
            }) => Promise<Record<string, never>>;
        };
        apple?: {
            clientId: string;
            clientSecret: string;
            mapProfileToUser: (profile: {
                email?: unknown;
            }) => Promise<Record<string, never>>;
        };
    };
    account: {
        accountLinking: {
            enabled: true;
            disableImplicitLinking: true;
        };
    };
    session: {
        expiresIn: typeof SESSION_SECONDS;
        disableSessionRefresh: true;
        freshAge: typeof FRESH_SECONDS;
        additionalFields?: {
            location: {
                type: "string";
                required: false;
                input: false;
            };
            deviceId: {
                type: "string";
                required: false;
                input: false;
                returned: false;
            };
        };
    };
    databaseHooks?: {
        account: {
            create: NoOAuthTokensHook;
            update: NoOAuthTokensHook;
        };
    };
    rateLimit: {
        enabled: true;
        storage: "database";
        customRules?: Record<string, {
            window: number;
            max: number;
        }>;
    };
    advanced: {
        ipAddress: {
            ipAddressHeaders: ["cf-connecting-ip"];
        };
    };
    trustedOrigins: string[];
}>;
/** Which buttons a sign-in page shows, for its loader to hand the page. */
/** @param {Parameters<typeof signInOptions>[0]} env */
export function signInMethods(env: Parameters<typeof signInOptions>[0], { social }?: {
    social?: boolean | undefined;
}): {
    google: boolean;
    apple: boolean;
    turnstileSiteKey: string | null;
};
/** @import { BetterAuthPlugin } from "better-auth" */
/** @typedef {import("./sign-in-link.mjs").EmailLinkProblem} EmailLinkProblem */
/** @typedef {import("./sign-in-link.mjs").SignInLinkProblem} SignInLinkProblem */
/** @typedef {import("./sign-in-account.mjs").AccountPasskey} AccountPasskey */
/** @typedef {import("./sign-in-account.mjs").AccountSession} AccountSession */
/** @typedef {import("./sign-in-account.mjs").D1Like} D1Like */
/** @typedef {import("./sign-in-account.mjs").NoticeDetail} NoticeDetail */
/** @typedef {import("./sign-in-account.mjs").SecurityHistoryEntry} SecurityHistoryEntry */
/** @typedef {import("./sign-in-account.mjs").SecurityNoticeKind} SecurityNoticeKind */
/** @typedef {import("./sign-in-account.mjs").SessionLookup} SessionLookup */
/** Where a page posts the code: Better Auth's email OTP sign-in, which signs in, or makes the account, as the link does. */
export const SIGN_IN_CODE_PATH: "/sign-in/email-otp";
/** Where a phone app asks for a code alone (`appCode: true`): the email OTP plugin's own send endpoint. */
export const APP_CODE_PATH: "/email-otp/send-verification-otp";
/** The app's code request, held tighter than the default: three a minute, since no Turnstile sits in front of it. */
export const APP_CODE_RATE_LIMIT: Readonly<{
    window: 60;
    max: 3;
}>;
/**
 * How long a session lasts from its sign-in, however much it is used: 30 days, NIST SP 800-63B-4's overall timeout for
 * AAL1. Better Auth's default slides forward with every use; refresh is off, so this is a cap.
 */
export const SESSION_SECONDS: number;
/**
 * How long a session may sit unused before it ends: 7 days. OWASP ASVS 5 v7.3.1 (L2) asks for an inactivity timeout
 * set by risk; NIST SP 800-63B-4 sets none at AAL1, and Admin gets its hour from Cloudflare Access (`ADMIN_IDLE_SECONDS`).
 */
export const SESSION_IDLE_SECONDS: number;
/** Sign-in mails per address: five an hour, Foxhound's limit (the link request, and the app's code request). */
export const LINK_EMAIL_RULES: readonly Readonly<{
    limit: 5;
    windowSeconds: number;
}>[];
/**
 * Wrong sign-in codes per address, across links: three an hour (a code's own three tries) and ten a day. A new link
 * brings a new code but no fresh tries; the link itself still works.
 */
export const CODE_EMAIL_RULES: readonly (Readonly<{
    limit: 3;
    windowSeconds: number;
}> | Readonly<{
    limit: 10;
    windowSeconds: number;
}>)[];
/** Failed passkey or social sign-ins per address: ten an hour. */
export const SIGN_IN_FAILURE_RULES: readonly Readonly<{
    limit: 10;
    windowSeconds: number;
}>[];
/** Failed sign-ins per passkey (credential id): 100 in 30 days, NIST SP 800-63B-4's cap per authenticator. */
export const PASSKEY_FAILURE_RULES: readonly Readonly<{
    limit: 100;
    windowSeconds: number;
}>[];
/** The one value of `turnstile` that lets the link request through without keys, until the site has them. */
export const TURNSTILE_OFF_UNTIL_KEYS: "off-until-keys";
export type SendMagicLink = (data: {
    email: string;
    url: string;
    token: string;
    code: string;
}, ctx?: unknown) => Promise<void> | void;
export type SendSignInCode = (data: {
    email: string;
    code: string;
}, ctx?: unknown) => Promise<void> | void;
export type SendSecurityNotice = import("./sign-in-account.mjs").SendSecurityNotice;
export type SignInEnv = {
    BETTER_AUTH_URL: string;
    TURNSTILE_SITE_KEY?: string | undefined;
    TURNSTILE_SECRET_KEY?: string | undefined;
    GOOGLE_CLIENT_ID?: string | undefined;
    GOOGLE_CLIENT_SECRET?: string | undefined;
    APPLE_CLIENT_ID?: string | undefined;
    APPLE_TEAM_ID?: string | undefined;
    APPLE_KEY_ID?: string | undefined;
    APPLE_PRIVATE_KEY?: string | undefined;
};
/**
 * The hook that blanks an account row's OAuth tokens before Better Auth writes it.
 */
export type NoOAuthTokensHook = {
    before: () => Promise<{
        data: {
            accessToken: null;
            refreshToken: null;
            idToken: null;
            accessTokenExpiresAt: null;
            refreshTokenExpiresAt: null;
        };
    }>;
};
export type EmailLinkProblem = import("./sign-in-link.mjs").EmailLinkProblem;
export type SignInLinkProblem = import("./sign-in-link.mjs").SignInLinkProblem;
export type AccountPasskey = import("./sign-in-account.mjs").AccountPasskey;
export type AccountSession = import("./sign-in-account.mjs").AccountSession;
export type D1Like = import("./sign-in-account.mjs").D1Like;
export type NoticeDetail = import("./sign-in-account.mjs").NoticeDetail;
export type SecurityHistoryEntry = import("./sign-in-account.mjs").SecurityHistoryEntry;
export type SecurityNoticeKind = import("./sign-in-account.mjs").SecurityNoticeKind;
export type SessionLookup = import("./sign-in-account.mjs").SessionLookup;
import { limit } from "./rate-limit/index.mjs";
import { magicLink } from "better-auth/plugins";
import { emailOTP } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import type { BetterAuthPlugin } from "better-auth";
import { FRESH_SECONDS } from "./sign-in-account.mjs";
export { CONFIRM_PATH, EMAIL_CONFIRM_PATH, SIGN_IN_EXPIRES_IN_SECONDS, SIGN_IN_EXPIRES_IN_WORDS, SIGN_IN_PATH, SIGN_IN_LINK_WORDS, confirmEmailLink, confirmSignInLink, emailConfirmURL, emailLinkResult, signInLinkProblem } from "./sign-in-link.mjs";
export { AUTH_EVENTS_DEVICE_SQL, AUTH_EVENTS_SQL, DEVICE_COOKIE, SESSION_DETAILS_SQL, SESSION_TOUCH_SECONDS, FRESH_SECONDS, PASSKEY_OFFER_DAYS, SECURITY_NOTICE_KINDS, SessionNotFresh, accountPasskeys, accountSessions, coarseLocation, deviceName, dismissPasskeyOffer, needsSecondPasskey, passkeyLabel, passkeyLastUsed, passkeyProvider, passkeyRows, pruneAuthEvents, pruneAuthEventsJob, pruneExpiredAuth, requireFreshSession, revokeSessionById, securityHistory, sessionIsFresh, sessionLookup, sessionRows, sessionTouch, shouldOfferPasskey } from "./sign-in-account.mjs";
