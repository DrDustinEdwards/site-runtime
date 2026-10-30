/** The one sign-in every family site offers (sign-in.mjs): passkey, email link, optional Google and Apple. */
import type { passkey } from "@better-auth/passkey";
import type { captcha, emailOTP, magicLink } from "better-auth/plugins";

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
  },
): Promise<{
  emailAndPassword: { enabled: false };
  /** Typed one by one, so a site's auth.api knows the magic-link, email OTP and passkey endpoints. */
  plugins: [ReturnType<typeof magicLink>, ReturnType<typeof emailOTP>, ReturnType<typeof passkey>, ...ReturnType<typeof captcha>[]];
  disabledPaths: string[];
  socialProviders: { google?: { clientId: string; clientSecret: string }; apple?: { clientId: string; clientSecret: string } };
  account: { accountLinking: { enabled: true; disableImplicitLinking: true } };
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
