import { isEmail, isRecipientSuppressed } from "./email.mjs";
import { logEvent, requestFields } from "./log.mjs";
import { SessionNotFresh, requireFreshSession, revokeSessionById } from "./sign-in-account.mjs";
import { isDisposableEmail } from "./sign-in-disposable.mjs";
import { SIGN_IN_INTENT, errorCode } from "./sign-in-handler.mjs";
import { emailConfirmURL } from "./sign-in-link.mjs";
import {
  ACCOUNT_WORDS,
  EMAIL_CHANGE_EXPIRES_IN_SECONDS,
  EMAIL_CHANGE_EXPIRES_IN_WORDS,
} from "./sign-in-words.mjs";
import { isSameOriginPath } from "./url.mjs";

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
export const ACCOUNT_INTENTS = Object.freeze(
  /** @type {const} */ (["change-email", "sign-out-device", "delete-account"]),
);

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
  if (!(/** @type {readonly string[]} */ (ACCOUNT_INTENTS).includes(intent))) return null;
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
      // The current address is suppressed (./email logged it as a warning): no approval link can reach it.
      if (isRecipientSuppressed(error))
        return answer({ error: ACCOUNT_WORDS.emailUndeliverable }, 422);
      logEvent(
        "email_change_failed",
        { ...requestFields(request), reason: errorCodeOf(error) },
        { level: "error" },
      );
      return answer({ error: ACCOUNT_WORDS.emailFailed }, 500);
    }
    return answer({ sentTo: fresh.user.email });
  }

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
