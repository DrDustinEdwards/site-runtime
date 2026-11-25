/**
 * The sign-in page's server side, the same on every site: what its route action does with the form, where a sign-in
 * may land, the Google and Apple start, the email change and account deletion options, and the words for each answer.
 * Capsomer's sign-in screen (`capsomer/react/sign-in`) is the page these answer.
 *
 * - THROUGH THE HANDLER, NEVER auth.api: only Better Auth's HTTP handler runs its rate limiter and the captcha plugin's
 *   Turnstile check, so a form that called auth.api skipped both. Each request is a POST
 *   to the site's own handler with the origin Better Auth checks, the client address its limiter counts and the user
 *   agent, and nothing else of the browser's.
 * - THE SAME ANSWER FOR EVERY ADDRESS: a link request says "sent" whether or not the address has an account; the only
 *   refusals shown are about the site (the check, the limits, the link switched off), never the address.
 * - NEVER LOGGED: the address, the code and the link. A failure logs its status and Better Auth's code only.
 * - ONE SET OF WORDS (SIGN_IN_WORDS): every site says the same thing for the same answer.
 */
import { logEvent, OWASP_EVENTS, requestFields } from "./log.mjs";
import {
  SIGN_IN_INTENT,
  errorCode,
  forwardedHeaders,
  postToHandler,
  setCookies,
} from "./sign-in-handler.mjs";
import { UNDELIVERABLE_EMAIL } from "./sign-in-link.mjs";
import { DISPOSABLE_EMAIL, SIGN_IN_WORDS } from "./sign-in-words.mjs";
import { isSameOriginPath } from "./url.mjs";

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

const CODE_PATH = "/sign-in/email-otp";

export { isDisposableEmail, refuseDisposable } from "./sign-in-disposable.mjs";
export { SIGN_IN_INTENT } from "./sign-in-handler.mjs";
export { accountFormAction, accountOptions, ACCOUNT_INTENTS } from "./sign-in-account-form.mjs";

/**
 * Where a sign-in may land: a path on this site, or `fallback`. Every check is anchored at the start, because the
 * path's own query may carry an absolute URL (an OAuth authorize page's redirect_uri, RFC 8707's resource=), and a
 * substring check would break those. Refused: absolute and protocol-relative ("//host") targets, a backslash ("/\host",
 * which some browsers read as "//host"), and any character outside printable ASCII (a browser strips a tab or newline,
 * so "/\t/host" becomes "//host", and a header cannot carry the rest). A value encoded twice ("%2Fpath") is decoded
 * once more; one already a path is left alone, since a second decode would rewrite its query. With `within`, the path
 * must also be one of those paths or under one ("/account" takes "/account", "/account/x" and "/account?x"), after its
 * dot segments are resolved, so "/account/../admin" is "/admin".
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
  if (!isSameOriginPath(path)) return fallback;
  // The path the browser will land on: dot segments ("/account/../admin", "/account/%2e%2e/admin") resolved, so
  // `within` is checked against where the reader actually goes.
  const resolved = new URL(path, "https://x.invalid");
  path = resolved.pathname + resolved.search + resolved.hash;
  // Resolving can itself make a protocol-relative path ("/..//host" is "//host"), so the check runs again.
  if (!isSameOriginPath(path)) return fallback;
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
 * @typedef {import("./sign-in-handler.mjs").AuthLike} AuthLike
 * @typedef {"limited" | "email-limited" | "check-failed" | "unavailable" | "undeliverable" | "failed"} LinkRefusal
 * @typedef {"wrong" | "expired" | "spent" | "limited" | "email-limited" | "unavailable" | "disposable" | "other-browser" | "failed"} CodeRefusal
 */

/**
 * Asks Better Auth for the sign-in mail (the link and its code). `callbackURL` is where the link lands,
 * `newUserCallbackURL` where it lands for a new account (default the same), `errorCallbackURL` where a spent or
 * expired link goes (the confirm page, which says which). Each is a path or an absolute URL on the site. A sent mail's
 * answer carries the Set-Cookie that ties its code to this browser (`./sign-in`'s codeBrowser): the page's answer must
 * send it, or the code typed in this tab is refused.
 * @param {AuthLike} auth
 * @param {Request} request
 * @param {{ email: string, captchaToken?: string, callbackURL: string, newUserCallbackURL?: string, errorCallbackURL?: string }} link
 * @returns {Promise<{ status: "sent", headers: Headers } | { status: LinkRefusal }>}
 */
export async function requestSignInLink(auth, request, link) {
  const headers = forwardedHeaders(request);
  if (link.captchaToken) headers.set("x-captcha-response", link.captchaToken);
  try {
    const res = await postToHandler(auth, request, "/sign-in/magic-link", headers, {
      email: link.email,
      callbackURL: link.callbackURL,
      newUserCallbackURL: link.newUserCallbackURL ?? link.callbackURL,
      ...(link.errorCallbackURL ? { errorCallbackURL: link.errorCallbackURL } : {}),
    });
    if (res.ok) return { status: "sent", headers: setCookies(res) };
    const code = await errorCode(res);
    // Better Auth's per-IP limit, or the address's five mails an hour (EMAIL_RATE_LIMITED), which says "later".
    if (res.status === 429)
      return { status: code === "EMAIL_RATE_LIMITED" ? "email-limited" : "limited" };
    // The captcha plugin's refusals: no token, or one Cloudflare would not pass.
    if (code === "MISSING_RESPONSE" || code === "VERIFICATION_FAILED")
      return { status: "check-failed" };
    // Turnstile's keys are missing (TURNSTILE_NOT_SET, failing closed), or the per-address counter is down.
    if (res.status === 503) return { status: "unavailable" };
    // Email Service has the address on its suppression list (./sign-in, UNDELIVERABLE_EMAIL); ./email logged it.
    if (code === UNDELIVERABLE_EMAIL) return { status: "undeliverable" };
    logEvent(
      "sign_in_link_failed",
      { ...requestFields(request), status: res.status, reason: code },
      { level: "error" },
    );
    return { status: "failed" };
  } catch {
    // The site's sendMagicLink throws with its reason, never the link; the address is in the request, so not here.
    logEvent(
      "sign_in_link_failed",
      { ...requestFields(request), status: "threw" },
      { level: "error" },
    );
    return { status: "failed" };
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
    const headers = forwardedHeaders(request, { codeCookie: true });
    const res = await postToHandler(auth, request, CODE_PATH, headers, { email, otp: code });
    if (res.ok) return { status: "signed-in", headers: setCookies(res) };
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
    if (reason === "CODE_OTHER_BROWSER") return { status: "other-browser" };
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
 * HTTP `status` for the page, and after a sent mail `headers` too, which the page's answer must send (the cookie that
 * ties the code to this browser).
 * @param {AuthLike} auth
 * @param {Request} request
 * @param {FormData} form
 * @param {{ landing: (next: string) => string, newUserLanding?: (next: string) => string, errorLanding?: string,
 *   next?: { fallback?: string, within?: readonly string[] } }} site
 * @returns {Promise<{ location: string, headers: Headers } | { state: SignInFormState, status: number, headers?: Headers }>}
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
  if (result.status === "sent") return { ...answer({ sent: email }), headers: result.headers };
  const status = result.status.endsWith("limited")
    ? 429
    : result.status === "check-failed"
      ? 400
      : result.status === "unavailable"
        ? 503
        : result.status === "undeliverable"
          ? 422
          : 500;
  return answer({ error: SIGN_IN_WORDS.link[result.status] }, status);
}

/**
 * Starts a Google or Apple sign-in from the page's form POST (`/auth/google`, `/auth/apple`), so the provider and the
 * landing are decided on the server. Through `auth.handler`, so Better Auth's per-address limiter counts it. Answers the
 * provider's URL and Better Auth's Set-Cookie (its OAuth state), or null when the provider is not set up.
 * @param {AuthLike} auth
 * @param {Request} request
 * @param {{ provider: string, callbackURL: string, newUserCallbackURL?: string, errorCallbackURL: string }} start
 * @returns {Promise<{ location: string, headers: Headers } | null>}
 */
export async function startSocialSignIn(
  auth,
  request,
  { provider, callbackURL, newUserCallbackURL, errorCallbackURL },
) {
  const res = await postToHandler(auth, request, "/sign-in/social", forwardedHeaders(request), {
    provider,
    callbackURL,
    newUserCallbackURL: newUserCallbackURL ?? callbackURL,
    errorCallbackURL,
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
