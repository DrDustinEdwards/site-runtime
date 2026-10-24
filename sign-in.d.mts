/** The one sign-in every family site offers (sign-in.mjs): passkey, email link, optional Google and Apple. */
import type { passkey } from "@better-auth/passkey";
import type { captcha, magicLink } from "better-auth/plugins";

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

/** The Turnstile site key when the check on the email link is on (key and secret both set), else null. */
export function turnstileSiteKey(env: { TURNSTILE_SITE_KEY?: string; TURNSTILE_SECRET_KEY?: string }): string | null;

/** Better Auth options to spread into a site's betterAuth({ ... }) beside its database, sessions and hooks. */
export function signInOptions(
  env: SignInEnv,
  site: {
    siteName: string;
    sendMagicLink: (data: { email: string; url: string; token: string }, ctx?: unknown) => Promise<void> | void;
    social?: boolean;
  },
): Promise<{
  emailAndPassword: { enabled: false };
  /** Typed one by one, so a site's auth.api knows the passkey and magic-link endpoints. */
  plugins: [ReturnType<typeof magicLink>, ReturnType<typeof passkey>, ...ReturnType<typeof captcha>[]];
  socialProviders: { google?: { clientId: string; clientSecret: string }; apple?: { clientId: string; clientSecret: string } };
  account: { accountLinking: { enabled: true; disableImplicitLinking: true } };
  rateLimit: { enabled: true; storage: "database" };
  advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } };
  trustedOrigins: string[];
}>;

/** Which buttons a sign-in page shows. */
export function signInMethods(
  env: SignInEnv,
  options?: { social?: boolean },
): { google: boolean; apple: boolean; turnstileSiteKey: string | null };
