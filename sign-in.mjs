/**
 * The one way a person signs in to any of the family's sites, as Better Auth options a site spreads into its own
 * betterAuth({ ... }) beside its database, sessions and hooks. Chosen 2026-10-24 from current practice (passkeys first,
 * an emailed link as the way in before a passkey exists, social sign-in only where a consumer app wants the reach);
 * admins are not here, they come through Cloudflare Access (`./access`).
 *
 * - PASSKEY: the main way in, phishing-proof because the browser ties it to this site's domain. Its relying party is the
 *   host of BETTER_AUTH_URL, so a passkey made on the live site works only there. The site's headers need
 *   PASSKEY_OVERRIDES (`./headers`), or OSHP's Permissions-Policy refuses every passkey sign-in.
 * - EMAIL LINK AND CODE: first sign-in, a new device, recovery. No passwords: emailAndPassword is off. The one mail
 *   carries a link and a six-digit code (Better Auth's email OTP). The link signs in the browser that opens it, which
 *   is the mail app's, often not the tab that asked (a private window, a phone); the code is typed into the tab that
 *   asked, so that tab signs in too (Foxhound's live test, 2026-10-29). Both work once and last 15 minutes
 *   (SIGN_IN_EXPIRES_IN_SECONDS). A wrong code counts: three and the code is spent, though the link still works. Only
 *   the link request mails: the email OTP plugin's own send endpoints are off (disabledPaths), so the Turnstile check
 *   and the five a minute on the link request cover every sign-in mail.
 * - WHAT THE MAIL CARRIES: the site's sendMagicLink({ email, url, token, code }) gets Better Auth's link (`url`, which
 *   holds `token`) and the six-digit `code`. The mail must carry both, the link untouched and the code as text (Capsomer's
 *   magicLink template takes `code`), and say they last SIGN_IN_EXPIRES_IN_WORDS. A mail without the code leaves the tab
 *   that asked with nothing to type. Neither is ever logged: each signs in, so a send error must have them cut out.
 * - THE APP'S CODE, only when the site asks (`appCode: true`, with `sendSignInCode`). A phone app cannot open the link
 *   (it opens in the phone's browser) and cannot show the Turnstile widget, so it asks for a code alone at
 *   /email-otp/send-verification-otp (APP_CODE_PATH) and signs in at SIGN_IN_CODE_PATH. That one path is turned back on;
 *   every other email OTP path stays off. The code is the same plugin's (sign-in only, stored hashed, three tries, 15
 *   minutes); sendSignInCode({ email, code }) mails it, and only for a sign-in: a request for any other kind of code
 *   mails nothing. With no Turnstile in front of it, it is held to three a minute per address (APP_CODE_RATE_LIMIT).
 * - NO OAUTH TOKENS: with `social: true` the options carry `databaseHooks.account`, which blank Google's and Apple's
 *   tokens on every account write Better Auth makes (createOAuthUser, linkAccount, updateAccount). Sign-in reads none of
 *   them, so none are stored. A site with hooks of its own merges them: `databaseHooks: { ...signIn.databaseHooks, user }`.
 * - TURNSTILE on the email link when TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are both set (a key without its secret
 *   would show a widget nothing checks; a secret without its key would refuse everyone). The link is the one endpoint
 *   that mails a stranger. The widget is `./turnstile`.
 * - GOOGLE AND APPLE only when the site asks (`social: true`) and has the settings: GOOGLE_CLIENT_ID and
 *   GOOGLE_CLIENT_SECRET; APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY (`./apple-secret` makes the
 *   secret). Apple comes with Google, since an iPhone app that offers Google sign-in must offer Apple's too.
 * - ACCOUNTS ARE JOINED ONLY BY A SIGNED-IN PERSON (linkSocial), never by a matching email at sign-in, the recurring
 *   takeover path.
 * - RATE LIMITED IN THE DATABASE, keyed on Cloudflare's client address: Better Auth counts each request in one atomic
 *   database step, in every environment (not only when NODE_ENV says production), and the magic-link plugin adds its
 *   own five a minute. Sessions and the counts live in the site's D1 (the `session` and `rateLimit` tables), never KV,
 *   which is eventually consistent: a sign-out would take up to a minute to hold and a count could be lost.
 *
 * Async, because Apple's secret is signed with WebCrypto. A site builds its auth once per isolate and keeps the promise.
 */
import { passkey } from "@better-auth/passkey";
import { captcha, emailOTP, magicLink } from "better-auth/plugins";

import { appleClientSecret } from "./apple-secret.mjs";

/**
 * How long a sign-in link and its code work: 15 minutes. Better Auth's default is 5, which ran out while a person
 * found the mail and came back (Foxhound's live test, 2026-10-29); Supabase and Stytch default to an hour
 * (supabase.com/docs/guides/auth/auth-email-passwordless, stytch.com/docs/api-reference/consumer/api/magic-links/via-email/send-magic-link,
 * read 2026-10-29). A quarter of an hour covers a slow inbox and keeps a forwarded or leaked mail's window short.
 */
export const SIGN_IN_EXPIRES_IN_SECONDS = 15 * 60;

/** The same, in words, for the mail and the page that says a link was sent. */
export const SIGN_IN_EXPIRES_IN_WORDS = "15 minutes";

/** Where a page posts the code: Better Auth's email OTP sign-in, which signs in, or makes the account, as the link does. */
export const SIGN_IN_CODE_PATH = "/sign-in/email-otp";

/** Where a phone app asks for a code alone (`appCode: true`): the email OTP plugin's own send endpoint. */
export const APP_CODE_PATH = "/email-otp/send-verification-otp";

/** The app's code request, held tighter than the default: three a minute, since no Turnstile sits in front of it. */
export const APP_CODE_RATE_LIMIT = Object.freeze({ window: 60, max: 3 });

/** What every account write stores in place of Google's and Apple's tokens (`social: true`). */
const NO_OAUTH_TOKENS = Object.freeze({
  accessToken: null,
  refreshToken: null,
  idToken: null,
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
});

/** The email OTP plugin's endpoints that are off: every one that mails or reads a code outside the link request. */
const OTP_OFF_PATHS = [
  APP_CODE_PATH,
  "/email-otp/check-verification-otp",
  "/email-otp/verify-email",
  "/email-otp/request-password-reset",
  "/email-otp/reset-password",
  "/forget-password/email-otp",
  "/email-otp/request-email-change",
  "/email-otp/change-email",
];

/**
 * @typedef {(data: { email: string, url: string, token: string, code: string }, ctx?: unknown) => Promise<void> | void} SendMagicLink
 * @typedef {(data: { email: string, code: string }, ctx?: unknown) => Promise<void> | void} SendSignInCode
 */

/**
 * The Turnstile site key when the check on the email link is on, else null (the form then shows no widget).
 * @param {{ TURNSTILE_SITE_KEY?: string, TURNSTILE_SECRET_KEY?: string }} env
 */
export function turnstileSiteKey(env) {
  return env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY ? env.TURNSTILE_SITE_KEY : null;
}

/**
 * @param {{
 *   BETTER_AUTH_URL: string,
 *   TURNSTILE_SITE_KEY?: string, TURNSTILE_SECRET_KEY?: string,
 *   GOOGLE_CLIENT_ID?: string, GOOGLE_CLIENT_SECRET?: string,
 *   APPLE_CLIENT_ID?: string, APPLE_TEAM_ID?: string, APPLE_KEY_ID?: string, APPLE_PRIVATE_KEY?: string,
 * }} env
 * @param {{ siteName: string, sendMagicLink: SendMagicLink, social?: boolean, appCode?: boolean, sendSignInCode?: SendSignInCode }} site
 */
export async function signInOptions(env, { siteName, sendMagicLink, social = false, appCode = false, sendSignInCode }) {
  if (appCode && typeof sendSignInCode !== "function") throw new Error("appCode: true needs sendSignInCode to mail the code");
  const url = new URL(env.BETTER_AUTH_URL);
  /** @type {any[]} */
  const otp = emailOTP({
    expiresIn: SIGN_IN_EXPIRES_IN_SECONDS,
    allowedAttempts: 3,
    storeOTP: "hashed",
    // Called only through APP_CODE_PATH, which is open only with appCode; otherwise the code goes out in the link's
    // mail below. Only a sign-in code is mailed: the other kinds belong to endpoints that stay off.
    sendVerificationOTP: async ({ email, otp: code, type }, ctx) => {
      if (!appCode || !sendSignInCode) throw new Error("sign-in codes are sent only with the sign-in link");
      if (type === "sign-in") await sendSignInCode({ email, code }, ctx);
    },
  });
  const link = magicLink({
    expiresIn: SIGN_IN_EXPIRES_IN_SECONDS,
    // One request, one mail: the link's request makes the code too, through the plugin's own server-only endpoint,
    // so the code is stored the plugin's way (hashed, with its attempt count) and the newest code replaces the last.
    sendMagicLink: async (data, ctx) => {
      const context = /** @type {{ context: unknown }} */ (/** @type {unknown} */ (ctx)).context;
      const code = await otp.endpoints.createVerificationOTP({
        body: { email: data.email, type: "sign-in" },
        // @ts-expect-error the endpoint context Better Auth hands a plugin's hook
        context,
      });
      await sendMagicLink({ email: data.email, url: data.url, token: data.token, code }, ctx);
    },
  });
  const plugins = [link, otp, passkey({ rpID: url.hostname, rpName: siteName, origin: url.origin })];
  if (turnstileSiteKey(env) && env.TURNSTILE_SECRET_KEY) {
    plugins.push(
      captcha({ provider: "cloudflare-turnstile", secretKey: env.TURNSTILE_SECRET_KEY, endpoints: ["/sign-in/magic-link"] }),
    );
  }

  /** @type {Record<string, { clientId: string, clientSecret: string }>} */
  const socialProviders = {};
  if (social && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
  }
  const appleSecret = social ? await appleClientSecret(env) : null;
  if (appleSecret && env.APPLE_CLIENT_ID) {
    socialProviders.apple = { clientId: env.APPLE_CLIENT_ID, clientSecret: appleSecret };
  }

  const noTokens = { before: async () => ({ data: { ...NO_OAUTH_TOKENS } }) };
  return {
    emailAndPassword: { enabled: false },
    plugins,
    disabledPaths: appCode ? OTP_OFF_PATHS.filter((path) => path !== APP_CODE_PATH) : [...OTP_OFF_PATHS],
    socialProviders,
    account: { accountLinking: { enabled: true, disableImplicitLinking: true } },
    ...(social ? { databaseHooks: { account: { create: noTokens, update: noTokens } } } : {}),
    rateLimit: appCode
      ? { enabled: true, storage: "database", customRules: { [APP_CODE_PATH]: { ...APP_CODE_RATE_LIMIT } } }
      : { enabled: true, storage: "database" },
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    // Apple returns to the site with a form POST from its own origin.
    trustedOrigins: socialProviders.apple ? ["https://appleid.apple.com"] : [],
  };
}

/** Which buttons a sign-in page shows, for its loader to hand the page. */
/** @param {Parameters<typeof signInOptions>[0]} env */
export function signInMethods(env, { social = false } = {}) {
  return {
    google: social && Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    apple: social && Boolean(env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY),
    turnstileSiteKey: turnstileSiteKey(env),
  };
}
