/** The one sign-in every family site offers (sign-in.mjs): passkey, email link, optional Google and Apple. */
import type { passkey } from "@better-auth/passkey";
import type { BetterAuthPlugin } from "better-auth";
import type { emailOTP, magicLink } from "better-auth/plugins";
import type { limit } from "./rate-limit/index.mjs";
import type { SendSecurityNotice } from "./sign-in-account.mjs";

export { CONFIRM_PATH, confirmSignInLink } from "./sign-in-link.mjs";
export {
  SECURITY_NOTICE_KINDS,
  coarseLocation,
  deviceName,
  passkeyLabel,
  passkeyProvider,
  sessionRows,
} from "./sign-in-account.mjs";
export type { NoticeDetail, SecurityNoticeKind, SendSecurityNotice } from "./sign-in-account.mjs";

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

/** How long a sign-in link and its code work: 15 minutes. */
export const SIGN_IN_EXPIRES_IN_SECONDS: number;
/** The same, in words: "15 minutes". */
export const SIGN_IN_EXPIRES_IN_WORDS: string;
/** Where a page posts { email, otp } to sign in with the code: "/sign-in/email-otp". */
export const SIGN_IN_CODE_PATH: "/sign-in/email-otp";

/** Where a phone app asks for a code alone, open only with `appCode: true`: "/email-otp/send-verification-otp". */
export const APP_CODE_PATH: "/email-otp/send-verification-otp";
/** The app's code request's limit per address: three a minute. */
export const APP_CODE_RATE_LIMIT: Readonly<{ window: 60; max: 3 }>;

/** How recent a sign-in must be for Better Auth's fresh-session endpoints: 600 seconds (session.freshAge). */
export const FRESH_SECONDS: 600;
/** Sign-in mails per address: five an hour. */
export const LINK_EMAIL_RULES: readonly [Readonly<{ limit: 5; windowSeconds: 3600 }>];
/** Typed sign-in codes per address, right or wrong: ten a day. */
export const CODE_EMAIL_RULES: readonly [Readonly<{ limit: 10; windowSeconds: 86400 }>];

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
    /** The site's RateLimiter Durable Object namespace (`./rate-limit`): turns on the per-address limits. */
    emailLimiter?: Parameters<typeof limit>[0];
    /**
     * Mails a security notice to `user.email`: a passkey added or removed, a sign-in method linked or unlinked, the email
     * changed (once to each address), every session or every other session ended, the account deleted. A throw is
     * logged and never blocks the change.
     */
    sendSecurityNotice?: SendSecurityNotice;
  },
): Promise<{
  emailAndPassword: { enabled: false };
  /**
   * Typed one by one, so a site's auth.api knows the magic-link, email OTP and passkey endpoints; then the sign-out
   * hook, the auth event log and notices, the captcha and the per-address limit, which add none.
   */
  plugins: [ReturnType<typeof magicLink>, ReturnType<typeof emailOTP>, ReturnType<typeof passkey>, ...BetterAuthPlugin[]];
  disabledPaths: string[];
  socialProviders: { google?: { clientId: string; clientSecret: string }; apple?: { clientId: string; clientSecret: string } };
  account: { accountLinking: { enabled: true; disableImplicitLinking: true } };
  /** A site that sets its own session options keeps this: `session: { ...signIn.session, ... }`. */
  session: { freshAge: typeof FRESH_SECONDS };
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
