/**
 * The one way a person signs in to any of the family's sites, as Better Auth options a site spreads into its own
 * betterAuth({ ... }) beside its database, sessions and hooks (passkeys first, an emailed link before a passkey exists,
 * social sign-in only where a consumer app wants the reach). Admins are not here, they come through Cloudflare Access
 * (`./access`).
 *
 * - PASSKEY: its relying party is the host of BETTER_AUTH_URL. The site's headers need PASSKEY_OVERRIDES (`./headers`),
 *   or OSHP's Permissions-Policy refuses every passkey sign-in. A new passkey must be discoverable (residentKey
 *   "required"), so it signs in from the browser's own list.
 * - EMAIL LINK AND CODE: first sign-in, a new device, recovery. No passwords: emailAndPassword is off. The one mail
 *   carries a link and a six-digit code (Better Auth's email OTP); the link signs in the browser that opens it (often
 *   not the tab that asked), the code is typed into the tab that asked. Both work once, last 10 minutes
 *   (SIGN_IN_EXPIRES_IN_SECONDS) and are stored hashed. Three wrong codes spend the code, and wrong codes count against
 *   the address across links (CODE_EMAIL_RULES). Only the link request mails: the OTP plugin's own send endpoints are
 *   off (disabledPaths), so the Turnstile check and the five a minute cover every sign-in mail.
 * - THE CODE WORKS ONLY IN THE BROWSER THAT ASKED (`codeBrowser`): the request that mails a code sets a signed CODE_COOKIE holding a random value whose SHA-256 is stored beside
 *   the code; a code typed with no cookie, or another browser's, is refused (400 CODE_OTHER_BROWSER) before the code is
 *   read, so it spends none of the tries (NIST SP 800-63B-4 3.2.5). The newest request replaces the binding. The link
 *   is not bound (a long random token, opened in the mail app's browser by design). The app's code (`appCode`) is bound
 *   the same way.
 * - THE LINK OPENS A PAGE, NOT A SIGN-IN: Better Auth's link is a GET that signs in, so a mail scanner would spend it.
 *   The mailed URL is the site's confirm page (`confirmPath`, CONFIRM_PATH by default) with the token in its query; its
 *   route action passes the POST to confirmSignInLink (`./sign-in-link.mjs`). A GET of the page signs nobody in.
 * - PER ADDRESS, AS WELL AS PER IP (`emailLimiter`, the site's RateLimiter Durable Object): five sign-in mails an hour,
 *   three wrong codes an hour and ten a day (across links), ten failed passkey or social sign-ins an hour (counted only
 *   once the request proved the address), and 100 a month per passkey (NIST SP 800-63B-4's cap). Checked in before
 *   hooks, so the form's auth.api call and a POST to /api/auth spend the same budget. A failing counter lets a mail or
 *   a passkey through (Foxhound's RULES.md 4.10) but refuses a typed code, the one thing a guesser can try a million of.
 * - WHAT THE MAIL CARRIES: the site's sendMagicLink({ email, url, token, code }) gets the confirm page's link (`url`,
 *   which holds `token`) and the `code`. The mail must carry both, the link untouched and the code as text, and say
 *   they last SIGN_IN_EXPIRES_IN_WORDS. Neither is ever logged: each signs in, so a send error must have them cut out.
 * - THE APP'S CODE, only when the site asks (`appCode: true`, with `sendSignInCode`). A phone app cannot open the link
 *   or show the Turnstile widget, so it asks for a code alone at APP_CODE_PATH and signs in at SIGN_IN_CODE_PATH; every
 *   other email OTP path stays off. `sendSignInCode({ email, code })` mails it, only for a sign-in. With no Turnstile
 *   in front, it is held to three a minute per address (APP_CODE_RATE_LIMIT).
 * - NO OAUTH TOKENS: with `social: true` the options carry `databaseHooks.account`, which blank Google's and Apple's
 *   tokens on every account write. A site with hooks of its own merges them: `databaseHooks: { ...signIn.databaseHooks, user }`.
 * - NO DISPOSABLE ADDRESSES: a plugin's user create hook refuses a new account at a disposable domain
 *   (`./sign-in-form`, isDisposableEmail), as BAD_REQUEST `disposable_email`. An existing account keeps working.
 * - TURNSTILE on the email link when TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are both set. Without both, the link
 *   request is refused (503 TURNSTILE_NOT_SET): it fails closed. A site waiting for its keys sets
 *   `turnstile: "off-until-keys"`, which lets it through with a warning line on every request. The widget is `./turnstile`.
 * - GOOGLE AND APPLE only when the site asks (`social: true`) and has the settings: GOOGLE_CLIENT_ID and
 *   GOOGLE_CLIENT_SECRET; APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY (`./apple-secret` makes the
 *   secret). Apple comes with Google, since an iPhone app that offers Google sign-in must offer Apple's too.
 * - FRESH: adding or deleting a passkey, changing the email, unlinking Google or Apple, deleting the account and
 *   listing sessions need a sign-in in the last FRESH_SECONDS (Better Auth's freshAge, and a before hook here for
 *   passkey delete and email change, which Better Auth leaves out). A site's own risky routes call requireFreshSession.
 * - SESSIONS END SESSION_SECONDS (30 days) after their sign-in: Better Auth's sliding refresh is off. A session also
 *   ends after SESSION_IDLE_SECONDS (7 days) unused (`sessionIdlePlugin`): its `updatedAt` moves on every read through
 *   /get-session, at most every SESSION_TOUCH_SECONDS, and a request with an idle session's cookie deletes it.
 * - SESSION DETAILS, when the site asks (`sessionDetails: true`, with SESSION_DETAILS_SQL's columns): each session keeps
 *   its coarse place (`coarseLocation` of request.cf) and a device id from a signed cookie (DEVICE_COOKIE), so the
 *   sessions list says where and when each was last used and the new-device notice tells a second browser of the same
 *   make from the first.
 * - SIGN-OUT CLEARS THE BROWSER: /sign-out answers with LOGOUT_HEADERS (`./headers`, Clear-Site-Data).
 * - EVERY AUTH EVENT IS LOGGED, AND EVERY CHANGE TO HOW A PERSON SIGNS IN IS TOLD TO THEM (`./sign-in-account.mjs`):
 *   one `./log` line per event from a plugin's hooks, and with the site's `sendSecurityNotice` a notice for each change
 *   (passkey, linked method, email to both addresses, sessions ended, account deleted, new device, recovery). A notice
 *   that fails to send is logged and the change stands. With `eventsDb` (AUTH_EVENTS_SQL) each event is also a row.
 * - A CHANGED EMAIL OR A RECOVERY ENDS EVERY OTHER SESSION; deleting the account ends them all (Better Auth).
 * - ACCOUNTS ARE JOINED ONLY BY A SIGNED-IN PERSON (linkSocial), never by a matching email at sign-in, the recurring
 *   takeover path.
 * - RATE LIMITED IN THE DATABASE, keyed on Cloudflare's client address, in every environment, and the magic-link plugin
 *   adds its own five a minute. Sessions and counts live in the site's D1 (`session`, `rateLimit`), never KV, which is
 *   eventually consistent: a sign-out would take up to a minute to hold and a count could be lost.
 *
 * Async, because Apple's secret is signed with WebCrypto. A site builds its auth once per isolate and keeps the promise.
 */
import { passkey } from "@better-auth/passkey";
import { APIError } from "better-auth/api";
import { captcha, emailOTP, magicLink } from "better-auth/plugins";

import { appleClientSecret } from "./apple-secret.mjs";
import { isRecipientSuppressed } from "./email.mjs";
import { FRESH_SECONDS, knownProvider } from "./sign-in-account.mjs";
import { codeBrowser } from "./sign-in-code.mjs";
import { accountEvents } from "./sign-in-events.mjs";
import { emailLimit, providerAddress } from "./sign-in-limit.mjs";
import {
  APP_CODE_PATH,
  APP_CODE_RATE_LIMIT,
  SESSION_SECONDS,
  TURNSTILE_OFF_UNTIL_KEYS,
} from "./sign-in-limits.mjs";
import {
  NO_DISPOSABLE,
  SESSION_FIELDS,
  SIGN_OUT_CLEARS,
  noTurnstile,
  sessionIdlePlugin,
  sessionTouchPlugin,
} from "./sign-in-plugins.mjs";
import {
  CONFIRM_PATH,
  SIGN_IN_EXPIRES_IN_SECONDS,
  UNDELIVERABLE_EMAIL,
  confirmLinkURL,
} from "./sign-in-link.mjs";

/**
 * @typedef {object} SignInEnv
 * @property {string} BETTER_AUTH_URL
 * @property {string} [TURNSTILE_SITE_KEY]
 * @property {string} [TURNSTILE_SECRET_KEY]
 * @property {string} [GOOGLE_CLIENT_ID]
 * @property {string} [GOOGLE_CLIENT_SECRET]
 * @property {string} [APPLE_CLIENT_ID]
 * @property {string} [APPLE_TEAM_ID]
 * @property {string} [APPLE_KEY_ID]
 * @property {string} [APPLE_PRIVATE_KEY]
 */

/**
 * The hook that blanks an account row's OAuth tokens before Better Auth writes it.
 * @typedef {object} NoOAuthTokensHook
 * @property {() => Promise<{ data: { accessToken: null; refreshToken: null; idToken: null; accessTokenExpiresAt: null; refreshTokenExpiresAt: null; }; }>} before
 */

export {
  CONFIRM_PATH,
  EMAIL_CONFIRM_PATH,
  SIGN_IN_EXPIRES_IN_SECONDS,
  SIGN_IN_EXPIRES_IN_WORDS,
  SIGN_IN_PATH,
  SIGN_IN_LINK_WORDS,
  confirmEmailLink,
  confirmSignInLink,
  emailConfirmURL,
  emailLinkResult,
  signInLinkProblem,
} from "./sign-in-link.mjs";
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
  requireFreshSession,
  revokeSessionById,
  securityHistory,
  sessionIsFresh,
  sessionLookup,
  sessionRows,
  sessionTouch,
  shouldOfferPasskey,
} from "./sign-in-account.mjs";
export {
  APP_CODE_PATH,
  APP_CODE_RATE_LIMIT,
  CODE_EMAIL_RULES,
  LINK_EMAIL_RULES,
  PASSKEY_FAILURE_RULES,
  SESSION_IDLE_SECONDS,
  SESSION_SECONDS,
  SIGN_IN_CODE_PATH,
  SIGN_IN_FAILURE_RULES,
  TURNSTILE_OFF_UNTIL_KEYS,
} from "./sign-in-limits.mjs";
export { pruneAuthEvents, pruneAuthEventsJob, pruneExpiredAuth } from "./sign-in-prune.mjs";

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
 * @typedef {import("./sign-in-account.mjs").SendSecurityNotice} SendSecurityNotice
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
 * @param {{
 *   siteName: string, sendMagicLink: SendMagicLink, social?: boolean, appCode?: boolean, sendSignInCode?: SendSignInCode,
 *   confirmPath?: string, emailLimiter?: Parameters<typeof import("./rate-limit/index.mjs").limit>[0], sendSecurityNotice?: SendSecurityNotice,
 *   eventsDb?: import("./sign-in-account.mjs").D1Like, turnstile?: typeof TURNSTILE_OFF_UNTIL_KEYS,
 *   sessionDetails?: boolean, turnstileHostnames?: string[],
 * }} site
 * @returns {Promise<{ emailAndPassword: { enabled: false }; plugins: [ ReturnType<typeof magicLink>, ReturnType<typeof emailOTP>, ReturnType<typeof passkey>, ...BetterAuthPlugin[], ]; disabledPaths: string[]; socialProviders: { google?: { clientId: string; clientSecret: string; mapProfileToUser: (profile: { email?: unknown }) => Promise<Record<string, never>> }; apple?: { clientId: string; clientSecret: string; mapProfileToUser: (profile: { email?: unknown }) => Promise<Record<string, never>> } }; account: { accountLinking: { enabled: true; disableImplicitLinking: true } }; session: { expiresIn: typeof SESSION_SECONDS; disableSessionRefresh: true; freshAge: typeof FRESH_SECONDS; additionalFields?: { location: { type: "string"; required: false; input: false }; deviceId: { type: "string"; required: false; input: false; returned: false } } }; databaseHooks?: { account: { create: NoOAuthTokensHook; update: NoOAuthTokensHook } }; rateLimit: { enabled: true; storage: "database"; customRules?: Record<string, { window: number; max: number }> }; advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } }; trustedOrigins: string[] }>}
 */
export async function signInOptions(
  env,
  {
    siteName,
    sendMagicLink,
    social = false,
    appCode = false,
    sendSignInCode,
    confirmPath = CONFIRM_PATH,
    emailLimiter,
    sendSecurityNotice,
    eventsDb,
    turnstile,
    sessionDetails = false,
    turnstileHostnames,
  },
) {
  if (turnstile !== undefined && turnstile !== TURNSTILE_OFF_UNTIL_KEYS)
    throw new Error(`turnstile is "${TURNSTILE_OFF_UNTIL_KEYS}" or left out`);
  if (appCode && typeof sendSignInCode !== "function")
    throw new Error("appCode: true needs sendSignInCode to mail the code");
  if (!confirmPath.startsWith("/") || confirmPath.startsWith("//"))
    throw new Error("confirmPath is a path on the site");
  const url = new URL(env.BETTER_AUTH_URL);
  const otp = emailOTP({
    expiresIn: SIGN_IN_EXPIRES_IN_SECONDS,
    allowedAttempts: 3,
    storeOTP: "hashed",
    // Called only through APP_CODE_PATH, which is open only with appCode; otherwise the code goes out in the link's
    // mail below. Only a sign-in code is mailed: the other kinds belong to endpoints that stay off.
    sendVerificationOTP: async ({ email, otp: code, type }, ctx) => {
      if (!appCode || !sendSignInCode)
        throw new Error("sign-in codes are sent only with the sign-in link");
      if (type === "sign-in") await refuseUndeliverable(sendSignInCode({ email, code }, ctx));
    },
  });
  const link = magicLink({
    expiresIn: SIGN_IN_EXPIRES_IN_SECONDS,
    storeToken: "hashed",
    // One request, one mail: the link's request makes the code too, through the plugin's own server-only endpoint,
    // so the code is stored the plugin's way (hashed, with its attempt count) and the newest code replaces the last.
    sendMagicLink: async (data, ctx) => {
      const context = /** @type {{ context: unknown }} */ (/** @type {unknown} */ (ctx)).context;
      const code = await otp.endpoints.createVerificationOTP({
        body: { email: data.email, type: "sign-in" },
        // @ts-expect-error the endpoint context Better Auth hands a plugin's hook
        context,
      });
      await refuseUndeliverable(
        sendMagicLink(
          {
            email: data.email,
            url: confirmLinkURL(data.url, confirmPath),
            token: data.token,
            code,
          },
          ctx,
        ),
      );
    },
  });
  /** @type {[ReturnType<typeof magicLink>, ReturnType<typeof emailOTP>, ReturnType<typeof passkey>, ...BetterAuthPlugin[]]} */
  const plugins = [
    link,
    otp,
    passkey({
      rpID: url.hostname,
      rpName: siteName,
      origin: url.origin,
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
      // A passkey the page did not name is stored with its provider's name, so a list never shows a blank.
      registration: {
        afterVerification: ({ ctx, verification }) => {
          const name = knownProvider(
            verification.registrationInfo?.aaguid,
            ctx.headers?.get("user-agent"),
          );
          return name ? { name } : undefined;
        },
      },
    }),
    SIGN_OUT_CLEARS,
    NO_DISPOSABLE,
    accountEvents(siteName, sendSecurityNotice, eventsDb ?? null, sessionDetails),
  ];
  plugins.push(sessionTouchPlugin(sessionDetails), sessionIdlePlugin());
  if (turnstileSiteKey(env) && env.TURNSTILE_SECRET_KEY) {
    plugins.push(
      captcha({
        provider: "cloudflare-turnstile",
        secretKey: env.TURNSTILE_SECRET_KEY,
        endpoints: ["/sign-in/magic-link"],
        // A token minted on another host is refused (ASVS 5 v13.x, Cloudflare's hostname check): the widget runs on the
        // page that posts here, and the auth origin is that page's origin (cookies and passkeys depend on it).
        allowedHostnames: turnstileHostnames ?? [new URL(env.BETTER_AUTH_URL).hostname],
      }),
    );
  } else plugins.push(noTurnstile(turnstile === TURNSTILE_OFF_UNTIL_KEYS));
  plugins.push(codeBrowser(), emailLimit(emailLimiter));

  // The provider's answer names the address a failed callback counts against (emailLimit).
  const mapProfileToUser = providerAddress(emailLimiter);
  /** @type {Record<string, { clientId: string, clientSecret: string, mapProfileToUser: typeof mapProfileToUser }>} */
  const socialProviders = {};
  if (social && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      mapProfileToUser,
    };
  }
  const appleSecret = social ? await appleClientSecret(env) : null;
  if (appleSecret && env.APPLE_CLIENT_ID) {
    socialProviders.apple = {
      clientId: env.APPLE_CLIENT_ID,
      clientSecret: appleSecret,
      mapProfileToUser,
    };
  }

  const noTokens = { before: async () => ({ data: { ...NO_OAUTH_TOKENS } }) };
  return {
    emailAndPassword: { enabled: false },
    plugins,
    disabledPaths: appCode
      ? OTP_OFF_PATHS.filter((path) => path !== APP_CODE_PATH)
      : [...OTP_OFF_PATHS],
    socialProviders,
    account: { accountLinking: { enabled: true, disableImplicitLinking: true } },
    session: {
      expiresIn: SESSION_SECONDS,
      disableSessionRefresh: true,
      freshAge: FRESH_SECONDS,
      ...(sessionDetails ? { additionalFields: SESSION_FIELDS } : {}),
    },
    ...(social ? { databaseHooks: { account: { create: noTokens, update: noTokens } } } : {}),
    rateLimit: appCode
      ? {
          enabled: true,
          storage: "database",
          customRules: { [APP_CODE_PATH]: { ...APP_CODE_RATE_LIMIT } },
        }
      : { enabled: true, storage: "database" },
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    // Apple returns to the site with a form POST from its own origin.
    trustedOrigins: socialProviders.apple ? ["https://appleid.apple.com"] : [],
  };
}

/**
 * Awaits a sign-in mail's send. A recipient on Email Service's suppression list (the sender threw `./email`
 * EmailNotSent, or anything with its code) becomes a 422 UNDELIVERABLE_EMAIL, so the page can say no mail can reach
 * that address. Any other failure is thrown as it came.
 * @param {unknown} sending a promise of the send, or what a synchronous sender returned
 */
async function refuseUndeliverable(sending) {
  try {
    await sending;
  } catch (error) {
    if (!isRecipientSuppressed(error)) throw error;
    throw new APIError("UNPROCESSABLE_ENTITY", {
      code: UNDELIVERABLE_EMAIL,
      message: "Email to this address can't be delivered.",
    });
  }
}

/** Which buttons a sign-in page shows, for its loader to hand the page. */
/** @param {Parameters<typeof signInOptions>[0]} env */
export function signInMethods(env, { social = false } = {}) {
  return {
    google: social && Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    apple:
      social &&
      Boolean(
        env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY,
      ),
    turnstileSiteKey: turnstileSiteKey(env),
  };
}
