/**
 * The emailed links' confirm steps, apart from `./sign-in` so they need no Better Auth import (and `npm test` covers
 * them without one); `./sign-in` re-exports them. Better Auth's sign-in link is GET /magic-link/verify and its
 * email-change link GET /verify-email, and each acts on the GET, so a mail scanner that opens every link spends a
 * sign-in link (or signs itself in) and approves an email change for the person. Each mail instead carries a page of
 * the site's own with one button; only that button's POST runs the verify.
 *
 * - THE SIGN-IN LINK: CONFIRM_PATH (or the site's `confirmPath`), `confirmLinkURL` for the mail, `confirmSignInLink`
 *   for the page's POST, `signInLinkProblem` for what the page says when the link failed.
 * - THE EMAIL-CHANGE LINKS (both of them: the approval to the current address, and the confirmation to the new one):
 *   EMAIL_CONFIRM_PATH (or the site's own), `emailConfirmURL` for the mails, `confirmEmailLink` for the page's POST,
 *   `emailLinkResult` for what the page says after.
 */

/** Where the mailed sign-in link opens unless the site names another page: "/sign-in/confirm". */
export const CONFIRM_PATH = "/sign-in/confirm";

/** Where the email-change links open unless the site names another page: "/email/confirm" (Foxhound's). */
export const EMAIL_CONFIRM_PATH = "/email/confirm";

/**
 * How long a sign-in link and its code work: 10 minutes, NIST SP 800-63B-4's limit for an out-of-band sign-in ("the
 * authentication SHALL be considered invalid unless completed within 10 minutes", pages.nist.gov/800-63-4, read
 * 2026-10-31). Better Auth's default is 5, which ran out while a person found the mail and came back (Foxhound's live
 * test, 2026-10-29).
 */
export const SIGN_IN_EXPIRES_IN_SECONDS = 10 * 60;

/** The same, in words, for the mail and the page that says a link was sent. */
export const SIGN_IN_EXPIRES_IN_WORDS = "10 minutes";

/** The verify endpoint's query parameters, carried from Better Auth's link to the page and back. */
const LINK_PARAMS = ["token", "callbackURL", "newUserCallbackURL", "errorCallbackURL"];

/** The page's parameter holding when the link was mailed (epoch ms), which tells a used link from an expired one. */
const SENT = "sent";

const NO_STORE = Object.freeze({ "Cache-Control": "no-store" });

/**
 * The confirm page's URL for Better Auth's link: the link's origin, `confirmPath`, the link's token and callbacks, and
 * `sent`, the time it was mailed.
 * @param {string} verifyUrl Better Auth's /magic-link/verify URL
 * @param {string} confirmPath
 * @param {number} [sentAt] epoch ms, now by default
 */
export function confirmLinkURL(verifyUrl, confirmPath, sentAt = Date.now()) {
  const verify = new URL(verifyUrl);
  const page = new URL(confirmPath, verify.origin);
  for (const name of LINK_PARAMS) {
    const value = verify.searchParams.get(name);
    if (value !== null) page.searchParams.set(name, value);
  }
  page.searchParams.set(SENT, String(Math.floor(sentAt)));
  return page.toString();
}

/**
 * The POST's parameters: from its own URL (a form with no action posts to the page's URL, query and all), else from
 * its form fields.
 * @param {Request} request
 * @returns {Promise<{ get(name: string): unknown }>}
 */
async function postedParams(request) {
  const posted = new URL(request.url);
  if (posted.searchParams.get("token")) return posted.searchParams;
  return (await request.clone().formData().catch(() => null)) ?? new URLSearchParams();
}

/**
 * A GET to Better Auth's own endpoint for the page's POST, so its limiter and checks run as for any request, with the
 * person's headers (their address for the limiter, their cookie) and Cloudflare's `cf`, so the session made carries
 * the place.
 * @param {Request} request @param {URL} url
 */
function verifyRequest(request, url) {
  const headers = new Headers(request.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  const cf = /** @type {{ cf?: unknown }} */ (request).cf;
  return new Request(url, /** @type {RequestInit} */ ({ method: "GET", headers, ...(cf ? { cf } : {}) }));
}

/** @param {string} value @param {string} origin @param {Record<string, string>} add */
function withParams(value, origin, add) {
  const url = new URL(value, origin);
  for (const [name, v] of Object.entries(add)) url.searchParams.set(name, v);
  return url.origin === origin && !/^[a-z][a-z0-9+.-]*:/i.test(value) ? `${url.pathname}${url.search}` : url.toString();
}

/**
 * The confirm page's POST: runs Better Auth's GET /magic-link/verify through `auth.handler` and returns its answer
 * untouched: a redirect to callbackURL with the session's Set-Cookie, a redirect to errorCallbackURL with `?error=`
 * for a spent, expired or unknown token, or 429. A spent link comes back to errorCallbackURL, else to this page, with
 * `sent` carried along, so `signInLinkProblem` can say whether it was used or ran out. Anything but a POST is 405 and
 * signs nobody in; no token is 400.
 * @param {{ handler: (request: Request) => Promise<Response>, options: { basePath?: string, [option: string]: unknown } }} auth
 * @param {Request} request
 */
export async function confirmSignInLink(auth, request) {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...NO_STORE, Allow: "POST" } });
  const posted = new URL(request.url);
  const params = await postedParams(request);
  const verify = new URL(`${auth.options.basePath || "/api/auth"}/magic-link/verify`, posted.origin);
  for (const name of LINK_PARAMS) {
    const value = params.get(name);
    if (typeof value === "string" && value) verify.searchParams.set(name, value);
  }
  if (!verify.searchParams.get("token")) return new Response(null, { status: 400, headers: NO_STORE });
  // Without a callbackURL Better Auth answers with the session token as JSON instead of a redirect.
  if (!verify.searchParams.get("callbackURL")) verify.searchParams.set("callbackURL", "/");
  const sent = params.get(SENT);
  const errorTo = verify.searchParams.get("errorCallbackURL") ?? posted.pathname;
  verify.searchParams.set("errorCallbackURL", withParams(errorTo, posted.origin, typeof sent === "string" && /^\d+$/.test(sent) ? { [SENT]: sent } : {}));
  return auth.handler(verifyRequest(request, verify));
}

/**
 * @typedef {"signed-in" | "used" | "expired" | "invalid" | "missing" | "failed"} SignInLinkProblem
 */

/**
 * What went wrong with a sign-in link, from the confirm page's URL, or null when nothing did (the page shows its
 * button). Better Auth answers INVALID_TOKEN for a used link and an expired one alike, so the time the link was mailed
 * (`sent`, which `confirmLinkURL` writes and `confirmSignInLink` carries back) tells them apart, txasm's way:
 * - "signed-in": the link failed but this browser is signed in (the person pressed twice, or used it already here);
 * - "used": INVALID_TOKEN within SIGN_IN_EXPIRES_IN_SECONDS of the mail;
 * - "expired": INVALID_TOKEN after it;
 * - "invalid": INVALID_TOKEN with no send time (a link from before this version, or one cut or edited);
 * - "missing": no token and no error: the link was cut short when copied;
 * - "failed": any other error (the account could not be made, the session could not be written).
 * @param {string | URL} url the page's URL
 * @param {{ signedIn?: boolean, now?: number }} [options]
 * @returns {SignInLinkProblem | null}
 */
export function signInLinkProblem(url, { signedIn = false, now = Date.now() } = {}) {
  const params = new URL(url).searchParams;
  const error = params.get("error");
  if (!error) return params.get("token") ? null : "missing";
  if (signedIn) return "signed-in";
  if (error !== "INVALID_TOKEN") return "failed";
  const sent = Number(params.get(SENT));
  if (!Number.isFinite(sent) || sent <= 0) return "invalid";
  return now - sent > SIGN_IN_EXPIRES_IN_SECONDS * 1000 ? "expired" : "used";
}

/** What the confirm page says for each problem: a title and a sentence, the action being "send yourself a new link". */
export const SIGN_IN_LINK_WORDS = Object.freeze({
  "signed-in": Object.freeze({
    title: "You are already signed in",
    text: "This link was used already, and this browser is signed in. There is nothing more to do.",
  }),
  used: Object.freeze({
    title: "This link was already used",
    text: "A sign-in link works once. If you opened it in another browser or on another device, you are signed in there. To sign in here, send yourself a new link.",
  }),
  expired: Object.freeze({
    title: "This link has expired",
    text: `A sign-in link works for ${SIGN_IN_EXPIRES_IN_WORDS}. Send yourself a new one.`,
  }),
  invalid: Object.freeze({
    title: "This link no longer works",
    text: `A sign-in link works once, for ${SIGN_IN_EXPIRES_IN_WORDS}. Send yourself a new one.`,
  }),
  missing: Object.freeze({
    title: "This link is not complete",
    text: "It may have been cut short when it was copied. Open it straight from the email, or send yourself a new one.",
  }),
  failed: Object.freeze({
    title: "That sign-in did not finish",
    text: "Something went wrong on our side. Send yourself a new link and try again.",
  }),
});

// ---- the email-change links ----------------------------------------------------------------------------

/**
 * The page an email-change link opens, for Better Auth's link: the link's origin, `confirmPath`, and the token alone
 * (the page sets its own callback when it posts). For both mails: `user.changeEmail.sendChangeEmailConfirmation`'s
 * `url` (to the current address) and `emailVerification.sendVerificationEmail`'s (to the new one).
 * @param {string} verifyUrl Better Auth's /verify-email URL
 * @param {string} [confirmPath]
 */
export function emailConfirmURL(verifyUrl, confirmPath = EMAIL_CONFIRM_PATH) {
  const verify = new URL(verifyUrl);
  const page = new URL(confirmPath, verify.origin);
  page.searchParams.set("token", verify.searchParams.get("token") ?? "");
  return page.toString();
}

/** Which step a token is, read without a check (Better Auth checks it on the POST): only its words depend on it. */
const STEPS = /** @type {const} */ ({ "change-email-confirmation": "approved", "change-email-verification": "changed" });

/** @param {unknown} token @returns {"approved" | "changed" | "verified"} */
function stepOf(token) {
  try {
    const payload = String(token).split(".")[1] ?? "";
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=")));
    return STEPS[/** @type {keyof typeof STEPS} */ (json.requestType)] ?? "verified";
  } catch {
    return "verified";
  }
}

/**
 * The email-change page's POST: runs Better Auth's GET /verify-email through `auth.handler` (its limiter and checks run)
 * and returns its answer untouched: a redirect to `callbackURL` (the page itself by default) with `done=approved` (the
 * current address approved; Better Auth has mailed the new one), `done=changed` (the new address confirmed; the change
 * is made, with the session's Set-Cookie for a browser that was signed out) or `done=verified`, or with `error=` when
 * Better Auth refused (`emailLinkResult` reads both); or 429. Anything but a POST is 405 and changes nothing; no token is
 * 400.
 * @param {{ handler: (request: Request) => Promise<Response>, options: { basePath?: string, [option: string]: unknown } }} auth
 * @param {Request} request
 * @param {{ callbackURL?: string }} [options] where to land after, a path on the site
 */
export async function confirmEmailLink(auth, request, { callbackURL } = {}) {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...NO_STORE, Allow: "POST" } });
  const posted = new URL(request.url);
  const token = (await postedParams(request)).get("token");
  if (typeof token !== "string" || !token) return new Response(null, { status: 400, headers: NO_STORE });
  const verify = new URL(`${auth.options.basePath || "/api/auth"}/verify-email`, posted.origin);
  verify.searchParams.set("token", token);
  // With a callbackURL Better Auth redirects on success and on a refusal (with ?error=), never answers JSON.
  verify.searchParams.set("callbackURL", withParams(callbackURL ?? posted.pathname, posted.origin, { done: stepOf(token) }));
  return auth.handler(verifyRequest(request, verify));
}

/**
 * @typedef {"expired" | "done" | "other-account" | "invalid" | "missing" | "failed"} EmailLinkProblem
 */

/** Better Auth's /verify-email refusals, by what they mean to the person. */
const EMAIL_ERRORS = /** @type {Record<string, EmailLinkProblem>} */ ({
  TOKEN_EXPIRED: "expired",
  // The old address belongs to no one: the change was made already, from this link or the other.
  USER_NOT_FOUND: "done",
  INVALID_USER: "other-account",
  INVALID_TOKEN: "invalid",
});

/**
 * What the email-change page shows, from its URL: `{ done }` after a confirmation ("approved", "changed" or
 * "verified"), `{ problem }` after a refusal ("expired", "done" for a change made already, "other-account" when this
 * browser is signed in to another account, "invalid", "failed") or for a page with no token ("missing"), and
 * `{ done: null, problem: null }` for the page with its button.
 * @param {string | URL} url
 * @returns {{ done: "approved" | "changed" | "verified" | null, problem: EmailLinkProblem | null }}
 */
export function emailLinkResult(url) {
  const params = new URL(url).searchParams;
  const error = params.get("error");
  if (error) return { done: null, problem: EMAIL_ERRORS[error] ?? "failed" };
  const done = params.get("done");
  if (done === "approved" || done === "changed" || done === "verified") return { done, problem: null };
  return { done: null, problem: params.get("token") ? null : "missing" };
}
