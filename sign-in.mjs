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
 *   asked, so that tab signs in too (Foxhound's live test, 2026-10-29). Both work once and last 15 minutes
 *   (SIGN_IN_EXPIRES_IN_SECONDS), and both are stored hashed. A wrong code counts: three and the code is spent, though
 *   the link still works. Only the link request mails: the email OTP plugin's own send endpoints are off
 *   (disabledPaths), so the Turnstile check and the five a minute on the link request cover every sign-in mail.
 * - THE LINK OPENS A PAGE, NOT A SIGN-IN: Better Auth's link is a GET that signs in, so a mail scanner that opens every
 *   link would spend it. The mailed URL is the site's confirm page (`confirmPath`, CONFIRM_PATH by default) with the
 *   token in its query; the page shows one button, and its route action passes the POST to confirmSignInLink
 *   (`./sign-in-link.mjs`), which runs the verify. A GET of the page signs nobody in.
 * - PER ADDRESS, AS WELL AS PER IP (`emailLimiter`, the site's RateLimiter Durable Object): five sign-in mails an hour
 *   and ten typed codes a day per address, so someone spread over many addresses can neither bomb one inbox nor guess
 *   its code across re-sent links (each new link brings a new code with a fresh three tries). Counted in a before
 *   hook, so the form's auth.api call and a POST straight to /api/auth spend the same budget; a failing counter lets
 *   the request through, as Foxhound's did (its RULES.md 4.10: a Durable Object hiccup must never lock a person out).
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
 *   that mails a stranger. The widget is `./turnstile`.
 * - GOOGLE AND APPLE only when the site asks (`social: true`) and has the settings: GOOGLE_CLIENT_ID and
 *   GOOGLE_CLIENT_SECRET; APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY (`./apple-secret` makes the
 *   secret). Apple comes with Google, since an iPhone app that offers Google sign-in must offer Apple's too.
 * - FRESH: adding a passkey, unlinking Google or Apple, deleting the account and listing sessions need a sign-in in
 *   the last FRESH_SECONDS (Better Auth's freshAge, which defaults to a day). Session lengths are the site's own.
 * - SIGN-OUT CLEARS THE BROWSER: Better Auth's /sign-out answers with LOGOUT_HEADERS (`./headers`, Clear-Site-Data).
 * - EVERY AUTH EVENT IS LOGGED, AND EVERY CHANGE TO HOW A PERSON SIGNS IN IS TOLD TO THEM (`./sign-in-account.mjs`):
 *   one `./log` line per event, with OWASP's names, from a plugin's hooks, so a site gets it with no code; and with the
 *   site's `sendSecurityNotice`, a notice for a passkey added or removed, a sign-in method linked or unlinked, the email
 *   changed (to both addresses), every session ended, and the account deleted. A notice that fails to send is logged
 *   and the change stands.
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
import { APIError, createAuthMiddleware, getOAuthState } from "better-auth/api";
import { captcha, emailOTP, magicLink } from "better-auth/plugins";

import { appleClientSecret } from "./apple-secret.mjs";
import { fromBase64url } from "./encoding.mjs";
import { LOGOUT_HEADERS } from "./headers.mjs";
import { OWASP_EVENTS, logEvent } from "./log.mjs";
import { emailKey, limit, mustStop } from "./rate-limit/index.mjs";
import { authEvent, logAuthEvent, noticeDetail, passkeyProvider, sendNoticeSafely } from "./sign-in-account.mjs";
import { CONFIRM_PATH, confirmLinkURL } from "./sign-in-link.mjs";

export { CONFIRM_PATH, confirmSignInLink } from "./sign-in-link.mjs";
export {
  SECURITY_NOTICE_KINDS,
  coarseLocation,
  deviceName,
  passkeyLabel,
  passkeyProvider,
  sessionRows,
} from "./sign-in-account.mjs";

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

/**
 * How recent a sign-in must be for Better Auth's fresh-session endpoints (session.freshAge): 10 minutes. Better Auth's
 * default is a day, so a session cookie taken any time in its first day could add a passkey of its own.
 */
export const FRESH_SECONDS = 10 * 60;

/** Sign-in mails per address: five an hour, Foxhound's limit (the link request, and the app's code request). */
export const LINK_EMAIL_RULES = Object.freeze([Object.freeze({ limit: 5, windowSeconds: 60 * 60 })]);

/** Typed sign-in codes per address, right or wrong: ten a day, far above the one or two a person types. */
export const CODE_EMAIL_RULES = Object.freeze([Object.freeze({ limit: 10, windowSeconds: 24 * 60 * 60 })]);

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
  },
) {
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
    accountEvents(siteName, sendSecurityNotice),
  ];
  if (turnstileSiteKey(env) && env.TURNSTILE_SECRET_KEY) {
    plugins.push(
      captcha({ provider: "cloudflare-turnstile", secretKey: env.TURNSTILE_SECRET_KEY, endpoints: ["/sign-in/magic-link"] }),
    );
  }
  if (emailLimiter) plugins.push(emailLimit(emailLimiter));

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
    session: { freshAge: FRESH_SECONDS },
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
 * The auth event log and the security notices (`./sign-in-account.mjs`) as one plugin: an after hook on every endpoint,
 * and database hooks for what only the rows show (a linked or unlinked account's provider, both addresses of an email
 * change, a deleted user's address). Every hook catches its own errors, logged as `auth_event_failed`: a throw from an
 * after hook would turn a change already made into an error answer. A notice goes through Better Auth's
 * `runInBackgroundOrAwait`, so a site with `advanced.backgroundTasks` (waitUntil) answers before the mail is sent.
 * @param {string} siteName
 * @param {SendSecurityNotice | undefined} sendSecurityNotice
 */
function accountEvents(siteName, sendSecurityNotice) {
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
                  await logAuthEvent({
                    event: OWASP_EVENTS.userUpdated,
                    fields: { change: "sign_in_linked", via: account.providerId, user_id: user.id },
                  });
                  await notify(ctx, "sign-in-linked", user, { provider: account.providerId });
                }),
            },
            delete: {
              // Only an unlink; deleting a user deletes its accounts too, and that is told as the deletion.
              after: (/** @type {any} */ account, /** @type {HookContext} */ ctx) =>
                safely(async () => {
                  if (!account || ctx?.path !== "/unlink-account") return;
                  await logAuthEvent({
                    event: OWASP_EVENTS.userUpdated,
                    fields: { change: "sign_in_unlinked", via: account.providerId, user_id: account.userId },
                  });
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
                  await logAuthEvent({ event: OWASP_EVENTS.userUpdated, fields: { change: "email_changed", user_id: user.id } });
                  const facts = { oldEmail: old, newEmail: user.email };
                  await notify(ctx, "email-changed", user, facts);
                  await notify(ctx, "email-changed", { ...user, email: old }, { ...facts, toOldAddress: true });
                }),
            },
            delete: {
              after: (/** @type {any} */ user, /** @type {HookContext} */ ctx) =>
                safely(async () => {
                  if (!user) return;
                  await logAuthEvent({ event: OWASP_EVENTS.userDeleted, fields: { user_id: user.id } });
                  await notify(ctx, "account-deleted", user);
                }),
            },
          },
        },
      },
    }),
    hooks: {
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
              await logAuthEvent(event);
              if (event.notice) await notify(ctx, event.notice.kind, user, event.notice);
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

/** The endpoints that spend an address's budget, and which one. */
const EMAIL_LIMITED = { "/sign-in/magic-link": LINK_EMAIL_RULES, [APP_CODE_PATH]: LINK_EMAIL_RULES, [SIGN_IN_CODE_PATH]: CODE_EMAIL_RULES };

/**
 * The per-address limit as a plugin's before hook. The captcha plugin and Better Auth's per-IP limit run first (both
 * on the request, before any hook), so a request without a Turnstile pass spends nothing of an address's budget.
 * @param {Parameters<typeof limit>[0]} namespace
 */
function emailLimit(namespace) {
  return {
    id: "sign-in-email-limit",
    hooks: {
      before: [
        {
          /** @param {{ path?: string }} ctx */
          matcher: (ctx) => Object.hasOwn(EMAIL_LIMITED, ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const path = /** @type {keyof typeof EMAIL_LIMITED} */ (ctx.path);
            const rules = EMAIL_LIMITED[path];
            const key = await emailKey(rules === CODE_EMAIL_RULES ? "code-email" : "link-email", ctx.body?.email);
            if (!key) return;
            const verdict = await limit(namespace, key, [...rules], { onUnavailable: "allow" });
            if (!mustStop(verdict, "allow")) return;
            await logAuthEvent({
              event: OWASP_EVENTS.rateLimitExceeded,
              fields: { endpoint: path, bucket: rules === CODE_EMAIL_RULES ? "code-email" : "link-email" },
              level: "warn",
              email: ctx.body?.email,
            });
            throw new APIError(
              "TOO_MANY_REQUESTS",
              { code: "EMAIL_RATE_LIMITED", message: "Too many tries for this address. Try again later." },
              { "Retry-After": String(verdict.retryAfterSeconds) },
            );
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
