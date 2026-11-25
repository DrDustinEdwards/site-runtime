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
 *   confirmPath?: string, emailLimiter?: Parameters<typeof import("./rate-limit/index.mjs").limit>[0], sendSecurityNotice?: SendSecurityNotice,
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
    emailLimiter?: Parameters<typeof import("./rate-limit/index.mjs").limit>[0];
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
import { TURNSTILE_OFF_UNTIL_KEYS } from "./sign-in-limits.mjs";
import { magicLink } from "better-auth/plugins";
import { emailOTP } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import type { BetterAuthPlugin } from "better-auth";
import { SESSION_SECONDS } from "./sign-in-limits.mjs";
import { FRESH_SECONDS } from "./sign-in-account.mjs";
export { CONFIRM_PATH, EMAIL_CONFIRM_PATH, SIGN_IN_EXPIRES_IN_SECONDS, SIGN_IN_EXPIRES_IN_WORDS, SIGN_IN_PATH, SIGN_IN_LINK_WORDS, confirmEmailLink, confirmSignInLink, emailConfirmURL, emailLinkResult, signInLinkProblem } from "./sign-in-link.mjs";
export { AUTH_EVENTS_DEVICE_SQL, AUTH_EVENTS_SQL, DEVICE_COOKIE, SESSION_DETAILS_SQL, SESSION_TOUCH_SECONDS, FRESH_SECONDS, PASSKEY_OFFER_DAYS, SECURITY_NOTICE_KINDS, SessionNotFresh, accountPasskeys, accountSessions, coarseLocation, deviceName, dismissPasskeyOffer, needsSecondPasskey, passkeyLabel, passkeyLastUsed, passkeyProvider, passkeyRows, requireFreshSession, revokeSessionById, securityHistory, sessionIsFresh, sessionLookup, sessionRows, sessionTouch, shouldOfferPasskey } from "./sign-in-account.mjs";
export { APP_CODE_PATH, APP_CODE_RATE_LIMIT, CODE_EMAIL_RULES, LINK_EMAIL_RULES, PASSKEY_FAILURE_RULES, SESSION_IDLE_SECONDS, SESSION_SECONDS, SIGN_IN_CODE_PATH, SIGN_IN_FAILURE_RULES, TURNSTILE_OFF_UNTIL_KEYS } from "./sign-in-limits.mjs";
export { pruneAuthEvents, pruneAuthEventsJob, pruneExpiredAuth } from "./sign-in-prune.mjs";
