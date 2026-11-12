/**
 * The sign-in page's server side, the same on every site: what its route action does with the form, where a sign-in
 * may land, the Google and Apple start, the email change and account deletion options, and the words for each answer.
 * Capsomer's sign-in screen (`capsomer/react/sign-in`) is the page these answer; together they replaced Foxhound's,
 * Foxing's and txasm's own copies (network shared-code audit, 2026-11-11, items 19-21 and 36).
 *
 * - THROUGH THE HANDLER, NEVER auth.api: only Better Auth's HTTP handler runs its rate limiter and the captcha plugin's
 *   Turnstile check, so a form that called auth.api skipped both (Grok audit 2026-10-21, TX-4). Each request is a POST
 *   to the site's own handler with the origin Better Auth checks, the client address its limiter counts and the user
 *   agent, and nothing else of the browser's.
 * - THE SAME ANSWER FOR EVERY ADDRESS: a link request says "sent" whether or not the address has an account; the only
 *   refusals shown are about the site (the check, the limits, the link switched off), never the address.
 * - NEVER LOGGED: the address, the code and the link. A failure logs its status and Better Auth's code only.
 * - ONE SET OF WORDS (SIGN_IN_WORDS): every site says the same thing for the same answer.
 */
import { APIError } from "better-auth/api";

import { DISPOSABLE_DOMAINS } from "./disposable-domains.mjs";
import { isEmail } from "./email.mjs";
import { OWASP_EVENTS, logEvent, requestFields } from "./log.mjs";
import { SessionNotFresh, requireFreshSession, revokeSessionById } from "./sign-in-account.mjs";
import { emailConfirmURL } from "./sign-in-link.mjs";
import { isSameOriginPath } from "./url.mjs";
import {
  ACCOUNT_WORDS,
  DISPOSABLE_EMAIL,
  EMAIL_CHANGE_EXPIRES_IN_SECONDS,
  EMAIL_CHANGE_EXPIRES_IN_WORDS,
  SIGN_IN_WORDS,
} from "./sign-in-words.mjs";

export {
  ACCOUNT_WORDS,
  DISPOSABLE_EMAIL,
  EMAIL_CHANGE_EXPIRES_IN_SECONDS,
  EMAIL_CHANGE_EXPIRES_IN_WORDS,
  SIGN_IN_WORDS,
  emailLinkWords,
  passkeyErrorWords,
  securityHistoryWords,
  signInErrorWords,
} from "./sign-in-words.mjs";

/** Better Auth's email OTP sign-in path (also SIGN_IN_CODE_PATH in `./sign-in`). */
const CODE_PATH = "/sign-in/email-otp";

/**
 * True when the address is at a disposable (throwaway) domain or a subdomain of one, from the list in
 * `./disposable-domains.mjs` (update-disposable.mjs, from disposable-email-domains, CC0).
 * @param {string} email
 */
export function isDisposableEmail(email) {
  const at = email.lastIndexOf("@");
  if (at === -1) return false;
  const labels = email
    .slice(at + 1)
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .split(".");
  for (let i = 0; i < labels.length - 1; i++)
    if (DISPOSABLE_DOMAINS.has(labels.slice(i).join("."))) return true;
  return false;
}

/**
 * The before hook on a new user that refuses a disposable address, whichever way the account is made (link, code,
 * Google, Apple). An existing account keeps working. `signInOptions` puts it in `databaseHooks.user.create`.
 * @param {{ email: string }} user
 */
export async function refuseDisposable(user) {
  if (isDisposableEmail(user.email))
    throw new APIError("BAD_REQUEST", {
      code: DISPOSABLE_EMAIL,
      message: "Disposable email addresses are not allowed.",
    });
}

/**
 * Where a sign-in may land: a path on this site, or `fallback`. Every check is anchored at the start, because the
 * path's own query may carry an absolute URL (an OAuth authorize page's redirect_uri, RFC 8707's resource=), and a
 * substring check would break those. Refused: absolute and protocol-relative ("//host") targets, a backslash ("/\host",
 * which some browsers read as "//host"), and any character outside printable ASCII (a browser strips a tab or newline,
 * so "/\t/host" becomes "//host", and a header cannot carry the rest). A value encoded twice ("%2Fpath") is decoded
 * once more; one already a path is left alone, since a second decode would rewrite its query. With `within`, the path
 * must also be one of those paths or under one ("/account" takes "/account", "/account/x" and "/account?x").
 * Foxhound's next-path.ts, which carried Recova's validateRedirect with its two holes closed.
 * @param {unknown} raw
 * @param {{ fallback?: string, within?: readonly string[] }} [options]
 */
export function safeNextPath(raw, { fallback = "/", within } = {}) {
  if (typeof raw !== "string" || !raw) return fallback;
  let path = raw;
  if (!path.startsWith("/")) {
    try {
      path = decodeURIComponent(path);
    } catch {
      return fallback;
    }
  }
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i);
    if (code <= 0x20 || code >= 0x7f) return fallback;
  }
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return fallback;
  if (
    within &&
    !within.some(
      (p) =>
        path === p ||
        path.startsWith(`${p}/`) ||
        path.startsWith(`${p}?`) ||
        path.startsWith(`${p}#`),
    )
  )
    return fallback;
  return path;
}

/**
 * Better Auth's base for the handler request: its baseURL and basePath, or the request's origin and "/api/auth".
 * @param {{ options?: { baseURL?: unknown, basePath?: string } }} auth
 * @param {Request} request
 * @param {string} path
 */
function handlerURL(auth, request, path) {
  const base = typeof auth.options?.baseURL === "string" ? auth.options.baseURL : request.url;
  return new URL(`${auth.options?.basePath ?? "/api/auth"}${path}`, base);
}

/**
 * The headers Better Auth's handler is handed for a signed-out POST: the origin it checks, the address its limiter
 * counts and the user agent.
 * @param {Request} request
 */
function forwardedHeaders(request) {
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const name of ["origin", "cf-connecting-ip", "user-agent"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

/** @param {Response} res */
async function errorCode(res) {
  const body = /** @type {{ code?: unknown }} */ (
    await res
      .clone()
      .json()
      .catch(() => ({}))
  );
  return typeof body.code === "string" ? body.code : undefined;
}

/**
 * @typedef {{ handler: (request: Request) => Promise<Response>, options?: { baseURL?: unknown, basePath?: string } }} AuthLike
 * @typedef {"sent" | "limited" | "email-limited" | "check-failed" | "unavailable" | "failed"} LinkResult
 * @typedef {"wrong" | "expired" | "spent" | "limited" | "email-limited" | "unavailable" | "disposable" | "failed"} CodeRefusal
 */

/**
 * Asks Better Auth for the sign-in mail (the link and its code). `callbackURL` is where the link lands,
 * `newUserCallbackURL` where it lands for a new account (default the same), `errorCallbackURL` where a spent or
 * expired link goes (the confirm page, which says which). Each is a path or an absolute URL on the site.
 * @param {AuthLike} auth
 * @param {Request} request
 * @param {{ email: string, captchaToken?: string, callbackURL: string, newUserCallbackURL?: string, errorCallbackURL?: string }} link
 * @returns {Promise<LinkResult>}
 */
export async function requestSignInLink(auth, request, link) {
  const headers = forwardedHeaders(request);
  if (link.captchaToken) headers.set("x-captcha-response", link.captchaToken);
  try {
    const res = await auth.handler(
      new Request(handlerURL(auth, request, "/sign-in/magic-link"), {
        method: "POST",
        headers,
        body: JSON.stringify({
          email: link.email,
          callbackURL: link.callbackURL,
          newUserCallbackURL: link.newUserCallbackURL ?? link.callbackURL,
          ...(link.errorCallbackURL ? { errorCallbackURL: link.errorCallbackURL } : {}),
        }),
      }),
    );
    if (res.ok) return "sent";
    const code = await errorCode(res);
    // Better Auth's per-IP limit, or the address's five mails an hour (EMAIL_RATE_LIMITED), which says "later".
    if (res.status === 429) return code === "EMAIL_RATE_LIMITED" ? "email-limited" : "limited";
    // The captcha plugin's refusals: no token, or one Cloudflare would not pass.
    if (code === "MISSING_RESPONSE" || code === "VERIFICATION_FAILED") return "check-failed";
    // Turnstile's keys are missing (TURNSTILE_NOT_SET, failing closed), or the per-address counter is down.
    if (res.status === 503) return "unavailable";
    logEvent(
      "sign_in_link_failed",
      { ...requestFields(request), status: res.status, reason: code },
      { level: "error" },
    );
    return "failed";
  } catch {
    // The site's sendMagicLink throws with its reason, never the link; the address is in the request, so not here.
    logEvent(
      "sign_in_link_failed",
      { ...requestFields(request), status: "threw" },
      { level: "error" },
    );
    return "failed";
  }
}

/**
 * Signs this browser in with the six-digit code from the same mail (Better Auth's email OTP). The link signs in the
 * browser that opens it, often the mail app's; the code signs in the tab that asked. A wrong code counts, and after
 * three it is spent while the link still works. On success the answer carries only the session's Set-Cookie headers,
 * for the page's redirect.
 * @param {AuthLike} auth
 * @param {Request} request
 * @param {{ email: string, code: string }} attempt
 * @returns {Promise<{ status: "signed-in", headers: Headers } | { status: CodeRefusal }>}
 */
export async function signInWithCode(auth, request, { email, code }) {
  try {
    const res = await auth.handler(
      new Request(handlerURL(auth, request, CODE_PATH), {
        method: "POST",
        headers: forwardedHeaders(request),
        body: JSON.stringify({ email, otp: code }),
      }),
    );
    if (res.ok) {
      const headers = new Headers();
      for (const cookie of res.headers.getSetCookie()) headers.append("Set-Cookie", cookie);
      return { status: "signed-in", headers };
    }
    const reason = await errorCode(res);
    // The status and Better Auth's code only: the body can carry the address.
    logEvent(
      OWASP_EVENTS.signInFailure,
      { ...requestFields(request), via: "code", status: res.status, reason },
      { level: "warn" },
    );
    if (res.status === 429)
      return { status: reason === "EMAIL_RATE_LIMITED" ? "email-limited" : "limited" };
    if (reason === "INVALID_OTP") return { status: "wrong" };
    if (reason === "OTP_EXPIRED") return { status: "expired" };
    if (reason === "TOO_MANY_ATTEMPTS") return { status: "spent" };
    if (reason === DISPOSABLE_EMAIL) return { status: "disposable" };
    // The wrong-code counter could not answer, so every code is refused rather than allow unlimited guesses.
    if (res.status === 503) return { status: "unavailable" };
    return { status: "failed" };
  } catch {
    logEvent(
      "sign_in_code_failed",
      { ...requestFields(request), status: "threw" },
      { level: "error" },
    );
    return { status: "failed" };
  }
}

/** The form field that says the post is a typed code, not a link request. */
export const SIGN_IN_INTENT = "intent";

/**
 * What the sign-in page shows after its action: the address the mail went to (the "Check your inbox" screen with the
 * code box), the email form's error, or the code's error.
 * @typedef {{ sent: string | null, error: string | null, codeError: string | null }} SignInFormState
 */

/**
 * The sign-in page's whole action. A post with `intent=code` signs in with the typed code; any other asks for the
 * link. `landing(next)` is where a sign-in by link or code goes (the passkey offer, or the page itself), from the
 * form's `next` checked by safeNextPath with `next`'s options; `newUserLanding` where a new account's link goes.
 * On a signed-in code the result has `location` and `headers` for the site's redirect; otherwise `state` and the
 * HTTP `status` for the page.
 * @param {AuthLike} auth
 * @param {Request} request
 * @param {FormData} form
 * @param {{ landing: (next: string) => string, newUserLanding?: (next: string) => string, errorLanding?: string,
 *   next?: { fallback?: string, within?: readonly string[] } }} site
 * @returns {Promise<{ location: string, headers: Headers } | { state: SignInFormState, status: number }>}
 */
export async function signInFormAction(auth, request, form, site) {
  const email = String(form.get("email") ?? "").trim();
  const next = safeNextPath(form.get("next"), site.next);
  /** @type {(state: Partial<SignInFormState>, status?: number) => { state: SignInFormState, status: number }} */
  const answer = (state, status = 200) => ({
    state: { sent: null, error: null, codeError: null, ...state },
    status,
  });
  if (!email) return answer({ error: SIGN_IN_WORDS.noEmail }, 400);

  if (form.get(SIGN_IN_INTENT) === "code") {
    const code = String(form.get("code") ?? "").replace(/\s+/g, "");
    if (!/^\d{6}$/.test(code)) return answer({ sent: email, codeError: SIGN_IN_WORDS.noCode }, 400);
    const result = await signInWithCode(auth, request, { email, code });
    if (result.status === "signed-in")
      return { location: site.landing(next), headers: result.headers };
    const status = result.status.endsWith("limited")
      ? 429
      : result.status === "unavailable"
        ? 503
        : result.status === "failed"
          ? 500
          : 400;
    return answer({ sent: email, codeError: SIGN_IN_WORDS.code[result.status] }, status);
  }

  const result = await requestSignInLink(auth, request, {
    email,
    captchaToken: String(form.get("cf-turnstile-response") ?? ""),
    callbackURL: site.landing(next),
    newUserCallbackURL: (site.newUserLanding ?? site.landing)(next),
    errorCallbackURL: site.errorLanding,
  });
  if (result === "sent") return answer({ sent: email });
  const status = result.endsWith("limited")
    ? 429
    : result === "check-failed"
      ? 400
      : result === "unavailable"
        ? 503
        : 500;
  return answer({ error: SIGN_IN_WORDS.link[result] }, status);
}

/**
 * Starts a Google or Apple sign-in from the page's form POST (`/auth/google`, `/auth/apple`), so the provider, the
 * landing and the state cookie are all decided on the server, never by a client-side call. Answers the provider's
 * URL and Better Auth's Set-Cookie (its OAuth state), or null when the provider is not set up.
 * @param {AuthLike & { api: { signInSocial: (input: { body: { provider: string, callbackURL: string, newUserCallbackURL: string, errorCallbackURL: string }, headers: Headers, asResponse: true }) => Promise<Response> } }} auth
 * @param {Request} request
 * @param {{ provider: string, callbackURL: string, newUserCallbackURL?: string, errorCallbackURL: string }} start
 * @returns {Promise<{ location: string, headers: Headers } | null>}
 */
export async function startSocialSignIn(
  auth,
  request,
  { provider, callbackURL, newUserCallbackURL, errorCallbackURL },
) {
  const res = await auth.api.signInSocial({
    body: {
      provider,
      callbackURL,
      newUserCallbackURL: newUserCallbackURL ?? callbackURL,
      errorCallbackURL,
    },
    headers: request.headers,
    asResponse: true,
  });
  const { url } = /** @type {{ url?: unknown }} */ (await res.json().catch(() => ({})));
  if (typeof url !== "string" || !url.startsWith("https://")) return null;
  const headers = new Headers();
  for (const cookie of res.headers.getSetCookie()) headers.append("Set-Cookie", cookie);
  return { location: url, headers };
}

/**
 * Better Auth's HTTP surface (/api/auth/*) for a site's route: the handler's answer, marked no-store when it says
 * nothing, since its answers carry sessions and passkey challenges and no browser or proxy may keep one.
 * @param {AuthLike} auth
 * @param {Request} request
 */
export async function authHandler(auth, request) {
  const answer = await auth.handler(request);
  if (answer.headers.has("Cache-Control")) return answer;
  // A copy, since a redirect's headers are immutable.
  const res = new Response(answer.body, answer);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/**
 * @typedef {(mail: { to: string, link: string, token: string, step: "current" | "new", newEmail?: string,
 *   expiresIn: string }) => Promise<void> | void} SendEmailChange
 */

/**
 * The account options every site spreads into betterAuth({ ... }) beside `signInOptions`: changing the email and
 * deleting the account, the same everywhere.
 * - EMAIL CHANGE TAKES TWO LINKS: the current address approves first, then the new address confirms itself, and only
 *   then does the email change, so a stolen session alone cannot move the account. Each link opens `confirmPath` (the
 *   site's page whose button posts, `confirmEmailLink`), never Better Auth's own GET, which a mail scanner would spend.
 *   Each lasts EMAIL_CHANGE_EXPIRES_IN_SECONDS. `sendEmailChange` mails both steps; `./sign-in`'s notice tells both
 *   addresses after. Nothing else mails a verification link (/send-verification-email is off).
 * - DELETION ONLY FROM THE SITE'S OWN ROUTE: Better Auth's /delete-user and its callback are off, so the account page's
 *   action calls auth.api.deleteUser after its fresh sign-in check, and `beforeDelete` (the site's hand-over or erase)
 *   runs first. Better Auth then removes the sessions, linked accounts and passkeys, then runs `afterDelete` (the site's
 *   clean-up outside its database, such as Foxhound revoking its Stripe grants), when the site has one.
 * @param {{ confirmPath: string, sendEmailChange: SendEmailChange, beforeDelete: (user: { id: string, email: string }) => Promise<void>, afterDelete?: (user: { id: string, email: string }) => Promise<void> }} site
 */
export function accountOptions({ confirmPath, sendEmailChange, beforeDelete, afterDelete }) {
  if (!isSameOriginPath(confirmPath)) throw new Error("confirmPath is a path on the site");
  /** @param {string} url */
  const confirmURL = (url) => emailConfirmURL(url, confirmPath);
  return {
    disabledPaths: ["/delete-user", "/delete-user/callback", "/send-verification-email"],
    user: {
      changeEmail: {
        enabled: true,
        /** @param {{ user: { email: string }, newEmail: string, url: string, token: string }} data */
        sendChangeEmailConfirmation: async ({ user, newEmail, url, token }) => {
          await sendEmailChange({
            to: user.email,
            link: confirmURL(url),
            token,
            step: "current",
            newEmail,
            expiresIn: EMAIL_CHANGE_EXPIRES_IN_WORDS,
          });
        },
      },
      deleteUser: { enabled: true, beforeDelete, afterDelete },
    },
    emailVerification: {
      expiresIn: EMAIL_CHANGE_EXPIRES_IN_SECONDS,
      // The second step: the link to the new address (user.email is it here).
      /** @param {{ user: { email: string }, url: string, token: string }} data */
      sendVerificationEmail: async ({ user, url, token }) => {
        await sendEmailChange({
          to: user.email,
          link: confirmURL(url),
          token,
          step: "new",
          expiresIn: EMAIL_CHANGE_EXPIRES_IN_WORDS,
        });
      },
    },
  };
}

/** The account page's posts `accountFormAction` answers, by their `intent` field. */
export const ACCOUNT_INTENTS = Object.freeze(["change-email", "sign-out-device", "delete-account"]);

/**
 * What the account page shows after one of its posts: which post (`intent`), whether it worked, the error words, and
 * `stale` when it needs a sign-in from the last FRESH_SECONDS first; `sentTo` is the current address the first
 * email-change link went to.
 * @typedef {{ intent: string, ok: boolean, error: string | null, stale: boolean, sentTo: string | null }} AccountFormState
 */

/** @param {unknown} error */
const isNotFresh = (error) =>
  error instanceof SessionNotFresh ||
  /** @type {{ body?: { code?: string } }} */ (error)?.body?.code === "SESSION_NOT_FRESH";

/**
 * @typedef {{ id: string, email: string, emailVerified?: boolean }} AccountUser
 * @typedef {{
 *   getSession(o: import("./sign-in-account.mjs").SessionLookup): Promise<{ session: { createdAt: Date | string, token: string }, user: AccountUser } | null>,
 *   listSessions(o: { headers: Headers }): Promise<import("./sign-in-account.mjs").SessionRow[]>,
 *   revokeSession(o: { headers: Headers, body: { token: string } }): Promise<unknown>,
 *   changeEmail(o: { headers: Headers, body: { newEmail: string } }): Promise<unknown>,
 *   deleteUser(o: { headers: Headers, body: Record<string, never>, asResponse: true }): Promise<Response>,
 * }} AccountApi
 */

/**
 * The account page's posts, the same on every site, for Capsomer's account settings: `intent=change-email` (field
 * `newEmail`), `intent=sign-out-device` (field `session`, a session id, so no token reaches the page) and
 * `intent=delete-account` (field `confirm`, the box the person ticked). Any other intent answers null, for the site's own
 * posts (a profile, Foxhound's Cancel account).
 * - EMAIL CHANGE: refused for a malformed, unchanged or disposable address and for an account whose address was never
 *   confirmed (Better Auth would then mail the new address alone); otherwise Better Auth's two-link change
 *   (`accountOptions`), whose answer is the same whether or not the new address is taken, so the page says nothing about
 *   it either.
 * - DELETE: needs a recent sign-in and the ticked box. `beforeDelete(user, form)` is the site's own step first (Foxing's
 *   club hand-over, read from the form); a string it returns is the refusal shown. Then Better Auth deletes the person
 *   (its own `beforeDelete` in `accountOptions` runs, and may refuse with an APIError whose message is shown), and the
 *   answer is `deletedLanding` with the cleared cookies.
 * - STALE: each of the three needs a sign-in from the last FRESH_SECONDS; without one the state has `stale: true` and
 *   the page offers "Sign in again".
 * @param {{ api: AccountApi }} auth
 * @param {Request} request
 * @param {FormData} form
 * @param {{ deletedLanding: string, beforeDelete?: (user: AccountUser, form: FormData) => Promise<string | null | undefined> }} site
 * @returns {Promise<{ location: string, headers: Headers } | { state: AccountFormState, status: number } | null>}
 */
export async function accountFormAction(auth, request, form, site) {
  const intent = String(form.get(SIGN_IN_INTENT) ?? "");
  if (!ACCOUNT_INTENTS.includes(intent)) return null;
  /** @type {(state: Partial<AccountFormState>, status?: number) => { state: AccountFormState, status: number }} */
  const answer = (state, status = 200) => ({
    state: { intent, ok: status < 400, error: null, stale: false, sentTo: null, ...state },
    status,
  });
  const stale = () =>
    answer(
      {
        stale: true,
        error: ACCOUNT_WORDS.stale[/** @type {keyof typeof ACCOUNT_WORDS.stale} */ (intent)],
      },
      403,
    );
  const { headers } = request;

  if (intent === "sign-out-device") {
    try {
      const ok = await revokeSessionById(auth, request, String(form.get("session") ?? ""));
      return ok ? answer({}) : answer({ error: ACCOUNT_WORDS.deviceFailed }, 404);
    } catch (error) {
      if (isNotFresh(error)) return stale();
      throw error;
    }
  }

  let fresh;
  try {
    fresh = await requireFreshSession(auth, request);
  } catch (error) {
    if (isNotFresh(error)) return stale();
    throw error;
  }
  if (!fresh) return stale();

  if (intent === "change-email") {
    const newEmail = String(form.get("newEmail") ?? "")
      .trim()
      .toLowerCase();
    if (!isEmail(newEmail)) return answer({ error: ACCOUNT_WORDS.noEmail }, 400);
    if (newEmail === fresh.user.email.toLowerCase())
      return answer({ error: ACCOUNT_WORDS.sameEmail }, 400);
    if (isDisposableEmail(newEmail)) return answer({ error: ACCOUNT_WORDS.disposable }, 400);
    if (fresh.user.emailVerified === false) return answer({ error: ACCOUNT_WORDS.unverified }, 400);
    try {
      await auth.api.changeEmail({ body: { newEmail }, headers });
    } catch (error) {
      if (isNotFresh(error)) return stale();
      logEvent(
        "email_change_failed",
        { ...requestFields(request), reason: errorCodeOf(error) },
        { level: "error" },
      );
      return answer({ error: ACCOUNT_WORDS.emailFailed }, 500);
    }
    return answer({ sentTo: fresh.user.email });
  }

  // delete-account
  if (!form.get("confirm")) return answer({ error: ACCOUNT_WORDS.noConfirm }, 400);
  const refused = await site.beforeDelete?.(fresh.user, form);
  if (refused) return answer({ error: refused }, 409);
  let res;
  try {
    res = await auth.api.deleteUser({ body: {}, headers, asResponse: true });
  } catch (error) {
    if (isNotFresh(error)) return stale();
    const message = /** @type {{ body?: { message?: unknown } }} */ (error)?.body?.message;
    if (typeof message === "string" && message) return answer({ error: message }, 409);
    throw error;
  }
  if (!res.ok) {
    const code = await errorCode(res);
    if (code === "SESSION_EXPIRED" || code === "SESSION_NOT_FRESH") return stale();
    const { message } = /** @type {{ message?: unknown }} */ (await res.json().catch(() => ({})));
    return answer(
      { error: typeof message === "string" && message ? message : ACCOUNT_WORDS.deleteFailed },
      res.status >= 500 ? 500 : 409,
    );
  }
  const cleared = new Headers();
  for (const cookie of res.headers.getSetCookie()) cleared.append("Set-Cookie", cookie);
  return { location: site.deletedLanding, headers: cleared };
}

/** Better Auth's error code, for the log; never the address. @param {unknown} error */
function errorCodeOf(error) {
  const code = /** @type {{ body?: { code?: unknown } }} */ (error)?.body?.code;
  return typeof code === "string" ? code : "unknown";
}
