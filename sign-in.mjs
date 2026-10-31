/**
 * The one way a person signs in to any of the family's sites, as Better Auth options a site spreads into its own
 * betterAuth({ ... }) beside its database, sessions and hooks. Chosen 2026-10-24 from current practice (passkeys first,
 * an emailed link as the way in before a passkey exists, social sign-in only where a consumer app wants the reach);
 * admins are not here, they come through Cloudflare Access (`./access`).
 *
 * - PASSKEY: the main way in, phishing-proof because the browser ties it to this site's domain. Its relying party is the
 *   host of BETTER_AUTH_URL, so a passkey made on the live site works only there. The site's headers need
 *   PASSKEY_OVERRIDES (`./headers`), or OSHP's Permissions-Policy refuses every passkey sign-in. A new passkey must be
 *   discoverable (residentKey "required"), so it signs in from the browser's own list without an email typed first.
 * - EMAIL LINK AND CODE: first sign-in, a new device, recovery. No passwords: emailAndPassword is off. The one mail
 *   carries a link and a six-digit code (Better Auth's email OTP). The link signs in the browser that opens it, which
 *   is the mail app's, often not the tab that asked (a private window, a phone); the code is typed into the tab that
 *   asked, so that tab signs in too (Foxhound's live test, 2026-10-29). Both work once and last 10 minutes
 *   (SIGN_IN_EXPIRES_IN_SECONDS), and both are stored hashed. A wrong code counts: three and the code is spent, though
 *   the link still works, and a wrong code counts against the address too, across links (CODE_EMAIL_RULES). Only the
 *   link request mails: the email OTP plugin's own send endpoints are off (disabledPaths), so the Turnstile check and
 *   the five a minute on the link request cover every sign-in mail.
 * - THE LINK OPENS A PAGE, NOT A SIGN-IN: Better Auth's link is a GET that signs in, so a mail scanner that opens every
 *   link would spend it. The mailed URL is the site's confirm page (`confirmPath`, CONFIRM_PATH by default) with the
 *   token in its query; the page shows one button, and its route action passes the POST to confirmSignInLink
 *   (`./sign-in-link.mjs`), which runs the verify. A GET of the page signs nobody in.
 * - PER ADDRESS, AS WELL AS PER IP (`emailLimiter`, the site's RateLimiter Durable Object): five sign-in mails an hour
 *   per address, so someone spread over many addresses cannot bomb one inbox; three wrong codes an hour and ten a day
 *   per address, counted across links, so a new link brings a new code but no fresh tries; ten failed passkey or
 *   social sign-ins an hour per address and 100 a month per passkey (NIST SP 800-63B-4's cap). Checked in before hooks,
 *   so the form's auth.api call and a POST straight to /api/auth spend the same budget. A failing counter lets a mail
 *   or a passkey through (a Durable Object hiccup must never lock a person out, Foxhound's RULES.md 4.10), but refuses
 *   a typed code, which is the one thing a guesser can try a million of; the link in the mail still works.
 * - WHAT THE MAIL CARRIES: the site's sendMagicLink({ email, url, token, code }) gets the confirm page's link (`url`,
 *   which holds `token`) and the six-digit `code`. The mail must carry both, the link untouched and the code as text
 *   (Capsomer's magicLink template takes `code`), and say they last SIGN_IN_EXPIRES_IN_WORDS. A mail without the code
 *   leaves the tab that asked with nothing to type. Neither is ever logged: each signs in, so a send error must have
 *   them cut out.
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
 *   that mails a stranger. Without both, the link request is refused (503 TURNSTILE_NOT_SET): it fails closed. A site
 *   waiting for its keys sets `turnstile: "off-until-keys"`, which lets it through unchecked with a warning line on
 *   every request. The widget is `./turnstile`.
 * - GOOGLE AND APPLE only when the site asks (`social: true`) and has the settings: GOOGLE_CLIENT_ID and
 *   GOOGLE_CLIENT_SECRET; APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY (`./apple-secret` makes the
 *   secret). Apple comes with Google, since an iPhone app that offers Google sign-in must offer Apple's too.
 * - FRESH: adding or deleting a passkey, changing the email, unlinking Google or Apple, deleting the account and
 *   listing sessions need a sign-in in the last FRESH_SECONDS (Better Auth's freshAge, which defaults to a day, and for
 *   passkey delete and email change, which Better Auth leaves out, a before hook here). A site's own risky routes
 *   call requireFreshSession (`./sign-in-account.mjs`).
 * - SESSIONS END SESSION_SECONDS (30 days) after their sign-in, used or not: Better Auth's sliding refresh is off.
 * - SIGN-OUT CLEARS THE BROWSER: Better Auth's /sign-out answers with LOGOUT_HEADERS (`./headers`, Clear-Site-Data).
 * - EVERY AUTH EVENT IS LOGGED, AND EVERY CHANGE TO HOW A PERSON SIGNS IN IS TOLD TO THEM (`./sign-in-account.mjs`):
 *   one `./log` line per event, with OWASP's names, from a plugin's hooks, so a site gets it with no code; and with the
 *   site's `sendSecurityNotice`, a notice for a passkey added or removed, a sign-in method linked or unlinked, the email
 *   changed (to both addresses), every session ended, the account deleted, a sign-in from a device not seen before,
 *   and a recovery (a sign-in by email with no passkey left). A notice that fails to send is logged and the change
 *   stands. With `eventsDb` (the site's D1, AUTH_EVENTS_SQL) each event is also a row, the person's security history.
 * - A CHANGED EMAIL OR A RECOVERY ENDS EVERY OTHER SESSION; deleting the account ends them all (Better Auth).
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
import { APIError, createAuthMiddleware, getOAuthState, getSessionFromCtx } from "better-auth/api";
import { captcha, emailOTP, magicLink } from "better-auth/plugins";

import { appleClientSecret } from "./apple-secret.mjs";
import { fromBase64url } from "./encoding.mjs";
import { LOGOUT_HEADERS } from "./headers.mjs";
import { OWASP_EVENTS, logEvent } from "./log.mjs";
import { emailKey, limit, mustStop } from "./rate-limit/index.mjs";
import {
  FRESH_SECONDS,
  authEvent,
  deviceName,
  hadPasskey,
  isNewDevice,
  logAuthEvent,
  noticeDetail,
  outcome,
  passkeyProvider,
  sendNoticeSafely,
  sessionIsFresh,
  signedInDevices,
} from "./sign-in-account.mjs";
import { CONFIRM_PATH, confirmLinkURL } from "./sign-in-link.mjs";

export { CONFIRM_PATH, confirmSignInLink } from "./sign-in-link.mjs";
export {
  AUTH_EVENTS_SQL,
  FRESH_SECONDS,
  SECURITY_NOTICE_KINDS,
  SessionNotFresh,
  accountSessions,
  coarseLocation,
  deviceName,
  passkeyLabel,
  passkeyProvider,
  pruneAuthEvents,
  requireFreshSession,
  revokeSessionById,
  securityHistory,
  sessionRows,
} from "./sign-in-account.mjs";

/**
 * How long a sign-in link and its code work: 10 minutes, NIST SP 800-63B-4's limit for an out-of-band sign-in ("the
 * authentication SHALL be considered invalid unless completed within 10 minutes", pages.nist.gov/800-63-4, read
 * 2026-10-31). Better Auth's default is 5, which ran out while a person found the mail and came back (Foxhound's live
 * test, 2026-10-29).
 */
export const SIGN_IN_EXPIRES_IN_SECONDS = 10 * 60;

/** The same, in words, for the mail and the page that says a link was sent. */
export const SIGN_IN_EXPIRES_IN_WORDS = "10 minutes";

/** Where a page posts the code: Better Auth's email OTP sign-in, which signs in, or makes the account, as the link does. */
export const SIGN_IN_CODE_PATH = "/sign-in/email-otp";

/** Where a phone app asks for a code alone (`appCode: true`): the email OTP plugin's own send endpoint. */
export const APP_CODE_PATH = "/email-otp/send-verification-otp";

/** The app's code request, held tighter than the default: three a minute, since no Turnstile sits in front of it. */
export const APP_CODE_RATE_LIMIT = Object.freeze({ window: 60, max: 3 });

/**
 * How long a session lasts from its sign-in, however much it is used: 30 days, NIST SP 800-63B-4's overall timeout for
 * AAL1 ("SHOULD be no more than 30 days"). Better Auth's default is 7 days that slide forward with every use, so a
 * session in steady use never ends; refresh is off, so this is a cap. Admin pages sit behind Cloudflare Access, whose
 * own session is the admin's shorter limit.
 */
export const SESSION_SECONDS = 30 * 24 * 60 * 60;

/** Sign-in mails per address: five an hour, Foxhound's limit (the link request, and the app's code request). */
export const LINK_EMAIL_RULES = Object.freeze([Object.freeze({ limit: 5, windowSeconds: 60 * 60 })]);

/**
 * Wrong sign-in codes per address, across links: three an hour (a code's own three tries) and ten a day. A new link
 * brings a new code but no fresh tries; the link itself still works.
 */
export const CODE_EMAIL_RULES = Object.freeze([
  Object.freeze({ limit: 3, windowSeconds: 60 * 60 }),
  Object.freeze({ limit: 10, windowSeconds: 24 * 60 * 60 }),
]);

/** Failed passkey or social sign-ins per address: ten an hour. */
export const SIGN_IN_FAILURE_RULES = Object.freeze([Object.freeze({ limit: 10, windowSeconds: 60 * 60 })]);

/** Failed sign-ins per passkey (credential id): 100 in 30 days, NIST SP 800-63B-4's cap per authenticator. */
export const PASSKEY_FAILURE_RULES = Object.freeze([Object.freeze({ limit: 100, windowSeconds: 30 * 24 * 60 * 60 })]);

/** The one value of `turnstile` that lets the link request through without keys, until the site has them. */
export const TURNSTILE_OFF_UNTIL_KEYS = "off-until-keys";

/** Better Auth endpoints whose own check has no age limit in 1.7.12, held to FRESH_SECONDS here. */
const FRESH_PATHS = new Set(["/passkey/delete-passkey", "/change-email"]);

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
 *   confirmPath?: string, emailLimiter?: Parameters<typeof limit>[0], sendSecurityNotice?: SendSecurityNotice,
 *   eventsDb?: import("./sign-in-account.mjs").D1Like, turnstile?: typeof TURNSTILE_OFF_UNTIL_KEYS,
 * }} site
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
  },
) {
  if (turnstile !== undefined && turnstile !== TURNSTILE_OFF_UNTIL_KEYS) throw new Error(`turnstile is "${TURNSTILE_OFF_UNTIL_KEYS}" or left out`);
  if (appCode && typeof sendSignInCode !== "function") throw new Error("appCode: true needs sendSignInCode to mail the code");
  if (!confirmPath.startsWith("/") || confirmPath.startsWith("//")) throw new Error("confirmPath is a path on the site");
  const url = new URL(env.BETTER_AUTH_URL);
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
      await sendMagicLink({ email: data.email, url: confirmLinkURL(data.url, confirmPath), token: data.token, code }, ctx);
    },
  });
  /** @type {import("better-auth").BetterAuthPlugin[]} */
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
          const name = passkeyProvider(verification.registrationInfo?.aaguid, ctx.headers?.get("user-agent"));
          return name ? { name } : undefined;
        },
      },
    }),
    SIGN_OUT_CLEARS,
    accountEvents(siteName, sendSecurityNotice, eventsDb ?? null),
  ];
  if (turnstileSiteKey(env) && env.TURNSTILE_SECRET_KEY) {
    plugins.push(
      captcha({ provider: "cloudflare-turnstile", secretKey: env.TURNSTILE_SECRET_KEY, endpoints: ["/sign-in/magic-link"] }),
    );
  } else plugins.push(noTurnstile(turnstile === TURNSTILE_OFF_UNTIL_KEYS));
  plugins.push(emailLimit(emailLimiter));

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
    session: { expiresIn: SESSION_SECONDS, disableSessionRefresh: true, freshAge: FRESH_SECONDS },
    ...(social ? { databaseHooks: { account: { create: noTokens, update: noTokens } } } : {}),
    rateLimit: appCode
      ? { enabled: true, storage: "database", customRules: { [APP_CODE_PATH]: { ...APP_CODE_RATE_LIMIT } } }
      : { enabled: true, storage: "database" },
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    // Apple returns to the site with a form POST from its own origin.
    trustedOrigins: socialProviders.apple ? ["https://appleid.apple.com"] : [],
  };
}

/**
 * Better Auth's /sign-out answers with Clear-Site-Data. A plugin's after hook rather than the options' `hooks.after`,
 * which a site with a hook of its own would replace without a word.
 */
const SIGN_OUT_CLEARS = {
  id: "sign-out-clears-site-data",
  hooks: {
    after: [
      {
        /** @param {{ path?: string }} ctx */
        matcher: (ctx) => ctx.path === "/sign-out",
        handler: createAuthMiddleware(async (ctx) => {
          for (const [name, value] of Object.entries(LOGOUT_HEADERS)) ctx.setHeader(name, value);
        }),
      },
    ],
  },
};

/**
 * The link request without Turnstile keys: refused (503 TURNSTILE_NOT_SET), unless the site set
 * `turnstile: "off-until-keys"`, which lets it through with a warning line each time.
 * @param {boolean} offUntilKeys
 */
function noTurnstile(offUntilKeys) {
  return {
    id: "sign-in-turnstile-missing",
    hooks: {
      before: [
        {
          /** @param {{ path?: string }} ctx */
          matcher: (ctx) => ctx.path === "/sign-in/magic-link",
          handler: createAuthMiddleware(async () => {
            if (offUntilKeys) {
              logEvent("turnstile_off_until_keys", { endpoint: "/sign-in/magic-link" }, { level: "warn" });
              return;
            }
            logEvent("turnstile_not_set", { endpoint: "/sign-in/magic-link" }, { level: "error" });
            throw new APIError("SERVICE_UNAVAILABLE", {
              code: "TURNSTILE_NOT_SET",
              message: "Sign-in by email is not available right now.",
            });
          }),
        },
      ],
    },
  };
}

/**
 * The auth event log and the security notices (`./sign-in-account.mjs`) as one plugin: an after hook on every endpoint,
 * and database hooks for what only the rows show (a linked or unlinked account's provider, both addresses of an email
 * change, a deleted user's address). Every hook catches its own errors, logged as `auth_event_failed`: a throw from an
 * after hook would turn a change already made into an error answer. A notice goes through Better Auth's
 * `runInBackgroundOrAwait`, so a site with `advanced.backgroundTasks` (waitUntil) answers before the mail is sent.
 * Its before hook holds passkey delete and email change to FRESH_SECONDS. A sign-in from a device the person's
 * sessions and history have not shown is told as `new-device`; a sign-in by link or code with no passkey left, by
 * someone whose history shows one, is a recovery: told, and every other session ended, as after an email change.
 * @param {string} siteName
 * @param {SendSecurityNotice | undefined} sendSecurityNotice
 * @param {import("./sign-in-account.mjs").D1Like | null} db
 */
function accountEvents(siteName, sendSecurityNotice, db) {
  /** @typedef {{ path?: string, query?: Record<string, unknown>, headers?: Headers, request?: Request, context?: any } | null | undefined} HookContext */
  /** @typedef {{ id: string, email: string, name?: string | null }} User */
  /** @type {WeakMap<object, string>} the address an update is about to replace, by the request it runs in */
  const replacedEmail = new WeakMap();

  /**
   * @param {HookContext} ctx
   * @param {import("./sign-in-account.mjs").SecurityNoticeKind} kind
   * @param {User | null | undefined} user
   * @param {Omit<Parameters<typeof noticeDetail>[1], "siteName">} [facts]
   */
  const notify = async (ctx, kind, user, facts = {}) => {
    if (!sendSecurityNotice || !user?.email) return;
    const request = ctx?.request;
    const detail = noticeDetail(kind, { siteName, request, userAgent: ctx?.headers?.get("user-agent"), ...facts });
    const notice = { user: { id: user.id, email: user.email, name: user.name ?? null }, ...(request ? { request } : {}), detail };
    const sending = sendNoticeSafely(sendSecurityNotice, kind, notice);
    await (ctx?.context?.runInBackgroundOrAwait ? ctx.context.runInBackgroundOrAwait(sending) : sending);
  };
  /**
   * The event's line, and its row with `eventsDb`.
   * @param {Parameters<typeof logAuthEvent>[0]} event
   * @param {HookContext} ctx
   */
  const log = (event, ctx) => logAuthEvent(event, { db, request: ctx?.request, userAgent: ctx?.headers?.get("user-agent") });
  /**
   * Ends every session of the user but `keep` (the one that made the change, when it is theirs).
   * @param {HookContext} ctx
   * @param {string} userId
   * @param {string | undefined} keep
   * @param {string} reason
   */
  const endOtherSessions = async (ctx, userId, keep, reason) => {
    const adapter = ctx?.context?.internalAdapter;
    if (!adapter) return;
    const tokens = (await adapter.listSessions(userId))
      .map((/** @type {{ token: string }} */ row) => row.token)
      .filter((/** @type {string} */ token) => token !== keep);
    if (tokens.length === 0) return;
    await adapter.deleteSessions(tokens);
    await log({ event: OWASP_EVENTS.sessionExpired, fields: { reason, scope: "others", user_id: userId } }, ctx);
  };
  /**
   * What a new session is besides a sign-in: a recovery (link or code, no passkey left, one in the history), a new
   * device, or neither. Read before this sign-in's own row is written.
   * @param {any} ctx
   * @param {User} user
   * @param {{ session: { token: string, userAgent?: string | null } }} newSession
   * @param {unknown} via
   * @returns {Promise<"recovery" | "new-device" | null>}
   */
  const signInKind = async (ctx, user, newSession, via) => {
    if (db && (via === "link" || via === "code")) {
      const passkeys = await ctx.context.adapter.count({ model: "passkey", where: [{ field: "userId", value: user.id }] });
      if (passkeys === 0 && (await hadPasskey(db, user.id))) return "recovery";
    }
    const others = (await ctx.context.internalAdapter.listSessions(user.id)).filter(
      (/** @type {{ token: string }} */ row) => row.token !== newSession.session.token,
    );
    const seen = others.map((/** @type {{ userAgent?: string | null }} */ row) => deviceName(row.userAgent));
    if (db) seen.push(...(await signedInDevices(db, user.id)));
    return isNewDevice(deviceName(newSession.session.userAgent ?? ctx.headers?.get("user-agent")), seen) ? "new-device" : null;
  };
  /** Runs a hook's work, and logs instead of throwing. @param {() => Promise<void>} run */
  const safely = async (run) => {
    try {
      await run();
    } catch (error) {
      logEvent("auth_event_failed", { error }, { level: "error" });
    }
  };

  return {
    id: "sign-in-account-events",
    init: () => ({
      options: {
        databaseHooks: {
          account: {
            create: {
              // A link, not a sign-up: the account joins a user who was signed in (/link-social) or who began the
              // OAuth flow as a link (/callback/:id, whose state names the user).
              after: (/** @type {any} */ account, /** @type {HookContext} */ ctx) =>
                safely(async () => {
                  if (!account || !ctx) return;
                  /** @type {User | null | undefined} */
                  let user = null;
                  if (ctx.path === "/link-social") user = ctx.context?.session?.user;
                  else if (ctx.path === "/callback/:id" && (await getOAuthState())?.link?.userId === account.userId) {
                    user = await ctx.context?.internalAdapter.findUserById(account.userId);
                  }
                  if (!user || user.id !== account.userId) return;
                  await log(
                    { event: OWASP_EVENTS.userUpdated, fields: { change: "sign_in_linked", via: account.providerId, user_id: user.id } },
                    ctx,
                  );
                  await notify(ctx, "sign-in-linked", user, { provider: account.providerId });
                }),
            },
            delete: {
              // Only an unlink; deleting a user deletes its accounts too, and that is told as the deletion.
              after: (/** @type {any} */ account, /** @type {HookContext} */ ctx) =>
                safely(async () => {
                  if (!account || ctx?.path !== "/unlink-account") return;
                  await log(
                    { event: OWASP_EVENTS.userUpdated, fields: { change: "sign_in_unlinked", via: account.providerId, user_id: account.userId } },
                    ctx,
                  );
                  await notify(ctx, "sign-in-unlinked", ctx.context?.session?.user, { provider: account.providerId });
                }),
            },
          },
          user: {
            update: {
              // The address being replaced: the signed-in user's (/change-email, or /verify-email from a signed-in
              // browser), else the one in /verify-email's token, which Better Auth has verified before it updates.
              before: (/** @type {any} */ data, /** @type {HookContext} */ ctx) =>
                safely(async () => {
                  if (typeof data?.email !== "string" || !ctx) return;
                  const old =
                    ctx.context?.session?.user?.email ?? (ctx.path === "/verify-email" ? emailInToken(ctx.query?.token) : null);
                  if (typeof old === "string") replacedEmail.set(ctx, old);
                }),
              after: (/** @type {any} */ user, /** @type {HookContext} */ ctx) =>
                safely(async () => {
                  const old = ctx ? replacedEmail.get(ctx) : undefined;
                  if (!old || !user?.email || old.toLowerCase() === String(user.email).toLowerCase()) return;
                  if (ctx) replacedEmail.delete(ctx);
                  await log({ event: OWASP_EVENTS.userUpdated, fields: { change: "email_changed", user_id: user.id } }, ctx);
                  const facts = { oldEmail: old, newEmail: user.email };
                  await notify(ctx, "email-changed", user, facts);
                  await notify(ctx, "email-changed", { ...user, email: old }, { ...facts, toOldAddress: true });
                  const current = ctx?.context?.session;
                  await endOtherSessions(ctx, user.id, current?.user?.id === user.id ? current.session?.token : undefined, "email_changed");
                }),
            },
            delete: {
              after: (/** @type {any} */ user, /** @type {HookContext} */ ctx) =>
                safely(async () => {
                  if (!user) return;
                  await logAuthEvent({ event: OWASP_EVENTS.userDeleted, fields: { user_id: user.id } });
                  // Their history goes with them; the log line above stays.
                  if (db) await db.prepare("DELETE FROM auth_events WHERE user_id = ?1").bind(user.id).run();
                  await notify(ctx, "account-deleted", user);
                }),
            },
          },
        },
      },
    }),
    hooks: {
      before: [
        {
          /** @param {{ path?: string }} ctx */
          matcher: (ctx) => FRESH_PATHS.has(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const found = await getSessionFromCtx(ctx);
            const freshAge = ctx.context.sessionConfig?.freshAge ?? FRESH_SECONDS;
            if (!found?.session || freshAge === 0 || sessionIsFresh(found.session, freshAge)) return;
            await safely(() =>
              log(
                {
                  event: OWASP_EVENTS.authorizationFailure,
                  fields: { reason: "SESSION_NOT_FRESH", endpoint: ctx.path, user_id: found.user.id },
                  level: "warn",
                },
                ctx,
              ),
            );
            throw new APIError("FORBIDDEN", { code: "SESSION_NOT_FRESH", message: "Session is not fresh" });
          }),
        },
      ],
      after: [
        {
          matcher: () => true,
          handler: createAuthMiddleware((ctx) =>
            safely(async () => {
              const newSession = ctx.context.newSession;
              /** @type {User | undefined} */
              const user = ctx.context.session?.user ?? newSession?.user;
              const event = authEvent({
                path: ctx.path,
                params: ctx.params,
                body: ctx.body,
                returned: ctx.context.returned,
                signedIn: Boolean(newSession),
                userId: user?.id,
                linking: ctx.path === "/callback/:id" && Boolean((await getOAuthState())?.link),
              });
              if (!event) return;
              const kind =
                event.event === OWASP_EVENTS.signInSuccess && user && newSession
                  ? await signInKind(ctx, user, newSession, event.fields.via)
                  : null;
              await log(event, ctx);
              if (event.notice) await notify(ctx, event.notice.kind, user, event.notice);
              if (kind === "recovery" && user && newSession) {
                await log({ event: OWASP_EVENTS.userUpdated, fields: { change: "recovered", via: event.fields.via, user_id: user.id } }, ctx);
                await endOtherSessions(ctx, user.id, newSession.session.token, "recovered");
              }
              if (kind) await notify(ctx, kind, user);
            }),
          ),
        },
      ],
    },
  };
}

/**
 * The `email` claim of /verify-email's token, read without a check because Better Auth has checked it in this request.
 * @param {unknown} token
 */
function emailInToken(token) {
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64url(String(token).split(".")[1]))).email;
  } catch {
    return null;
  }
}

/** The endpoints whose mails spend an address's budget, counted on each request. */
const MAIL_LIMITED = new Set(["/sign-in/magic-link", APP_CODE_PATH]);

/**
 * The address a failed passkey or social sign-in counts against, and the passkey's own key: the passkey's owner (by
 * the credential id in the body), or the address in an ID token (the app's Google or Apple sign-in, read unchecked:
 * it only names a counter). An OAuth redirect names no address until the provider answers, so only the per-IP limit
 * holds it.
 * @param {any} ctx
 * @returns {Promise<{ address: string | null, passkey: string | null }>}
 */
async function failureKeys(ctx) {
  if (ctx.path === "/passkey/verify-authentication") {
    const id = ctx.body?.response?.id;
    if (typeof id !== "string" || !id) return { address: null, passkey: null };
    const row = await ctx.context.adapter.findOne({ model: "passkey", where: [{ field: "credentialID", value: id }] });
    const user = row ? await ctx.context.internalAdapter.findUserById(row.userId) : null;
    return { address: await emailKey("sign-in-fail", user?.email), passkey: await emailKey("passkey-fail", id) };
  }
  const token = ctx.body?.idToken?.token;
  return { address: typeof token === "string" ? await emailKey("sign-in-fail", emailInToken(token)) : null, passkey: null };
}

/** The endpoints whose failures count against an address and a passkey. */
const FAILURE_LIMITED = new Set(["/passkey/verify-authentication", "/sign-in/social"]);

/**
 * The per-address limits as one plugin. Its before hooks run after the captcha plugin and Better Auth's per-IP limit
 * (both on the request, before any hook), so a request without a Turnstile pass spends nothing of an address's budget.
 * A mail is counted when asked for; a typed code, a passkey and a social sign-in are checked before (a peek, which
 * counts nothing) and counted only when they fail, in the after hook. A code is refused when the counter cannot
 * answer, and so is every code on a site with no `emailLimiter`; a mail or a passkey goes through.
 * @param {Parameters<typeof limit>[0] | undefined} namespace
 */
function emailLimit(namespace) {
  /**
   * @param {string} path @param {string} bucket @param {import("./rate-limit/limit.mjs").Verdict} verdict @param {unknown} email
   */
  const refuse = async (path, bucket, verdict, email) => {
    if (verdict.status === "unavailable") {
      throw new APIError("SERVICE_UNAVAILABLE", { code: "RATE_LIMIT_UNAVAILABLE", message: "Use the link in the email, or try again in a minute." });
    }
    await logAuthEvent({ event: OWASP_EVENTS.rateLimitExceeded, fields: { endpoint: path, bucket }, level: "warn", email });
    throw new APIError(
      "TOO_MANY_REQUESTS",
      { code: "EMAIL_RATE_LIMITED", message: "Too many tries for this address. Try again later." },
      { "Retry-After": String(verdict.retryAfterSeconds) },
    );
  };
  return {
    id: "sign-in-email-limit",
    hooks: {
      before: [
        {
          /** @param {{ path?: string }} ctx */
          matcher: (ctx) => Boolean(namespace) && MAIL_LIMITED.has(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const key = await emailKey("link-email", ctx.body?.email);
            if (!key) return;
            const verdict = await limit(namespace, key, [...LINK_EMAIL_RULES], { onUnavailable: "allow" });
            if (mustStop(verdict, "allow")) await refuse(ctx.path, "link-email", verdict, ctx.body?.email);
          }),
        },
        {
          /** @param {{ path?: string }} ctx */
          matcher: (ctx) => ctx.path === SIGN_IN_CODE_PATH,
          handler: createAuthMiddleware(async (ctx) => {
            const key = await emailKey("code-email", ctx.body?.email);
            if (!key) return;
            const verdict = await limit(namespace, key, [...CODE_EMAIL_RULES], { onUnavailable: "refuse", peek: true });
            if (mustStop(verdict, "refuse")) await refuse(ctx.path, "code-email", verdict, ctx.body?.email);
          }),
        },
        {
          /** @param {{ path?: string }} ctx */
          matcher: (ctx) => Boolean(namespace) && FAILURE_LIMITED.has(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const keys = await failureKeys(ctx);
            for (const [key, rules, bucket] of /** @type {const} */ ([
              [keys.passkey, PASSKEY_FAILURE_RULES, "passkey-fail"],
              [keys.address, SIGN_IN_FAILURE_RULES, "sign-in-fail"],
            ])) {
              if (!key) continue;
              const verdict = await limit(namespace, key, [...rules], { onUnavailable: "allow", peek: true });
              if (mustStop(verdict, "allow")) await refuse(ctx.path, bucket, verdict, undefined);
            }
          }),
        },
      ],
      after: [
        {
          /** @param {{ path?: string }} ctx */
          matcher: (ctx) => Boolean(namespace) && (ctx.path === SIGN_IN_CODE_PATH || FAILURE_LIMITED.has(ctx.path ?? "")),
          handler: createAuthMiddleware(async (ctx) => {
            try {
              if (ctx.context.newSession || outcome(ctx.context.returned).ok) return;
              if (ctx.path === SIGN_IN_CODE_PATH) {
                const key = await emailKey("code-email", ctx.body?.email);
                if (key) await limit(namespace, key, [...CODE_EMAIL_RULES], { onUnavailable: "allow" });
                return;
              }
              const keys = await failureKeys(ctx);
              if (keys.passkey) await limit(namespace, keys.passkey, [...PASSKEY_FAILURE_RULES], { onUnavailable: "allow" });
              if (keys.address) await limit(namespace, keys.address, [...SIGN_IN_FAILURE_RULES], { onUnavailable: "allow" });
            } catch (error) {
              logEvent("auth_event_failed", { error }, { level: "error" });
            }
          }),
        },
      ],
    },
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
