/** The one sign-in every family site offers (sign-in.mjs): passkey, email link, optional Google and Apple. */
import type { passkey } from "@better-auth/passkey";
import type { BetterAuthPlugin } from "better-auth";
import type { emailOTP, magicLink } from "better-auth/plugins";
import type { limit } from "./rate-limit/index.mjs";
import type { D1Like, FRESH_SECONDS, SendSecurityNotice } from "./sign-in-account.mjs";

export {
  CONFIRM_PATH,
  EMAIL_CONFIRM_PATH,
  SIGN_IN_EXPIRES_IN_SECONDS,
  SIGN_IN_EXPIRES_IN_WORDS,
  SIGN_IN_LINK_WORDS,
  confirmEmailLink,
  confirmSignInLink,
  emailConfirmURL,
  emailLinkResult,
  signInLinkProblem,
} from "./sign-in-link.mjs";
export type { EmailLinkProblem, SignInLinkProblem } from "./sign-in-link.mjs";
export {
  AUTH_EVENTS_DEVICE_SQL,
  AUTH_EVENTS_SQL,
  DEVICE_COOKIE,
  SESSION_DETAILS_SQL,
  SESSION_TOUCH_SECONDS,
  FRESH_SECONDS,
  PASSKEY_OFFER_DAYS,
  SECURITY_NOTICE_KINDS,
  SessionNotFresh,
  accountPasskeys,
  accountSessions,
  coarseLocation,
  deviceName,
  dismissPasskeyOffer,
  needsSecondPasskey,
  passkeyLabel,
  passkeyLastUsed,
  passkeyProvider,
  passkeyRows,
  pruneAuthEvents,
  requireFreshSession,
  revokeSessionById,
  securityHistory,
  sessionLookup,
  sessionRows,
  sessionTouch,
  shouldOfferPasskey,
} from "./sign-in-account.mjs";
export type {
  AccountPasskey,
  AccountSession,
  D1Like,
  NoticeDetail,
  SecurityHistoryEntry,
  SecurityNoticeKind,
  SendSecurityNotice,
} from "./sign-in-account.mjs";

type SignInEnv = {
  BETTER_AUTH_URL: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APPLE_CLIENT_ID?: string;
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
};

/** Where a page posts { email, otp } to sign in with the code: "/sign-in/email-otp". */
export const SIGN_IN_CODE_PATH: "/sign-in/email-otp";

/** Where a phone app asks for a code alone, open only with `appCode: true`: "/email-otp/send-verification-otp". */
export const APP_CODE_PATH: "/email-otp/send-verification-otp";
/** The app's code request's limit per address: three a minute. */
export const APP_CODE_RATE_LIMIT: Readonly<{ window: 60; max: 3 }>;

/** How long a session lasts from its sign-in, used or not: 30 days, in seconds (session.expiresIn, refresh off). */
export const SESSION_SECONDS: 2592000;
/** Sign-in mails per address: five an hour. */
export const LINK_EMAIL_RULES: readonly [Readonly<{ limit: 5; windowSeconds: 3600 }>];
/** Wrong sign-in codes per address, counted across links: three an hour and ten a day. */
export const CODE_EMAIL_RULES: readonly [Readonly<{ limit: 3; windowSeconds: 3600 }>, Readonly<{ limit: 10; windowSeconds: 86400 }>];
/** Failed passkey or social sign-ins per address: ten an hour. */
export const SIGN_IN_FAILURE_RULES: readonly [Readonly<{ limit: 10; windowSeconds: 3600 }>];
/** Failed sign-ins per passkey (credential id): 100 in 30 days. */
export const PASSKEY_FAILURE_RULES: readonly [Readonly<{ limit: 100; windowSeconds: 2592000 }>];
/** The `turnstile` value that lets the link request through unchecked until the site has its Turnstile keys. */
export const TURNSTILE_OFF_UNTIL_KEYS: "off-until-keys";

/** The hook that blanks an account row's OAuth tokens before Better Auth writes it. */
type NoOAuthTokensHook = {
  before: () => Promise<{
    data: { accessToken: null; refreshToken: null; idToken: null; accessTokenExpiresAt: null; refreshTokenExpiresAt: null };
  }>;
};

/** The Turnstile site key when the check on the email link is on (key and secret both set), else null. */
export function turnstileSiteKey(env: { TURNSTILE_SITE_KEY?: string; TURNSTILE_SECRET_KEY?: string }): string | null;

/** Better Auth options to spread into a site's betterAuth({ ... }) beside its database, sessions and hooks. */
export function signInOptions(
  env: SignInEnv,
  site: {
    siteName: string;
    /**
     * Mails the link and the six-digit code together. The mail carries `url` untouched and `code` as text, says they last
     * SIGN_IN_EXPIRES_IN_WORDS, and never logs either (`token` is the one inside `url`, for cutting it out of an error).
     */
    sendMagicLink: (data: { email: string; url: string; token: string; code: string }, ctx?: unknown) => Promise<void> | void;
    /** Google and Apple, when their settings are set; also the hooks that store no OAuth tokens. */
    social?: boolean;
    /** Opens APP_CODE_PATH, for a phone app that asks for a code alone; needs `sendSignInCode`. */
    appCode?: boolean;
    /** Mails the app's six-digit sign-in code (only a sign-in code is ever passed). Required with `appCode: true`. */
    sendSignInCode?: (data: { email: string; code: string }, ctx?: unknown) => Promise<void> | void;
    /** The page the mailed link opens, whose button's POST goes to confirmSignInLink. Default CONFIRM_PATH. */
    confirmPath?: string;
    /**
     * The site's RateLimiter Durable Object namespace (`./rate-limit`): the per-address limits. Without it, sign-in by a
     * typed code is refused (its wrong-code count fails closed); the link and passkeys still work.
     */
    emailLimiter?: Parameters<typeof limit>[0];
    /**
     * The site's D1 with AUTH_EVENTS_SQL applied: each auth event is also a row there, read back by securityHistory and
     * /health's authSpikeCheck, and needed to tell a recovery. Without it, events go to the log only.
     */
    eventsDb?: D1Like;
    /**
     * Without both Turnstile keys the link request is refused (503 TURNSTILE_NOT_SET). "off-until-keys" lets it through
     * unchecked, with a warning line on each request, until the keys are set. Any other value throws.
     */
    turnstile?: typeof TURNSTILE_OFF_UNTIL_KEYS;
    /**
     * Mails a security notice to `user.email`: a passkey added or removed, a sign-in method linked or unlinked, the email
     * changed (once to each address), every session or every other session ended, the account deleted, a sign-in from a
     * new device, a recovery. A throw is logged and never blocks the change.
     */
    sendSecurityNotice?: SendSecurityNotice;
    /**
     * Keeps each session's coarse place and device id (a signed, long-lived DEVICE_COOKIE) from its sign-in, and moves
     * its `updatedAt` and place when it is read through /get-session, at most every SESSION_TOUCH_SECONDS. Needs the
     * session columns in SESSION_DETAILS_SQL (Drizzle: `location`, `deviceId`), and with `eventsDb`
     * AUTH_EVENTS_DEVICE_SQL. The new-device notice then tells two browsers of the same make apart.
     */
    sessionDetails?: boolean;
  },
): Promise<{
  emailAndPassword: { enabled: false };
  /**
   * Typed one by one, so a site's auth.api knows the magic-link, email OTP and passkey endpoints; then the sign-out
   * hook, the auth event log and notices, the captcha and the per-address limit, which add none.
   */
  plugins: [ReturnType<typeof magicLink>, ReturnType<typeof emailOTP>, ReturnType<typeof passkey>, ...BetterAuthPlugin[]];
  disabledPaths: string[];
  socialProviders: {
    google?: { clientId: string; clientSecret: string; mapProfileToUser: (profile: { email?: unknown }) => Promise<Record<string, never>> };
    apple?: { clientId: string; clientSecret: string; mapProfileToUser: (profile: { email?: unknown }) => Promise<Record<string, never>> };
  };
  account: { accountLinking: { enabled: true; disableImplicitLinking: true } };
  /** A site that sets its own session options keeps this: `session: { ...signIn.session, ... }`. */
  session: {
    expiresIn: typeof SESSION_SECONDS;
    disableSessionRefresh: true;
    freshAge: typeof FRESH_SECONDS;
    /** With `sessionDetails`. */
    additionalFields?: {
      location: { type: "string"; required: false; input: false };
      deviceId: { type: "string"; required: false; input: false; returned: false };
    };
  };
  /** Present with `social: true`: no OAuth token is stored. Merge a site's own hooks beside it. */
  databaseHooks?: { account: { create: NoOAuthTokensHook; update: NoOAuthTokensHook } };
  /** `customRules` holds APP_CODE_PATH's three a minute with `appCode: true`. */
  rateLimit: { enabled: true; storage: "database"; customRules?: Record<string, { window: number; max: number }> };
  advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } };
  trustedOrigins: string[];
}>;

/** Which buttons a sign-in page shows. */
export function signInMethods(
  env: SignInEnv,
  options?: { social?: boolean },
): { google: boolean; apple: boolean; turnstileSiteKey: string | null };
