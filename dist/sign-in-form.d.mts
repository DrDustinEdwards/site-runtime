/**
 * Where a sign-in may land: a path on this site, or `fallback`. Every check is anchored at the start, because the
 * path's own query may carry an absolute URL (an OAuth authorize page's redirect_uri, RFC 8707's resource=), and a
 * substring check would break those. Refused: absolute and protocol-relative ("//host") targets, a backslash ("/\host",
 * which some browsers read as "//host"), and any character outside printable ASCII (a browser strips a tab or newline,
 * so "/\t/host" becomes "//host", and a header cannot carry the rest). A value encoded twice ("%2Fpath") is decoded
 * once more; one already a path is left alone, since a second decode would rewrite its query. With `within`, the path
 * must also be one of those paths or under one ("/account" takes "/account", "/account/x" and "/account?x"), after its
 * dot segments are resolved, so "/account/../admin" is "/admin".
 * @param {unknown} raw
 * @param {{ fallback?: string, within?: readonly string[] }} [options]
 */
export function safeNextPath(raw: unknown, { fallback, within }?: {
    fallback?: string;
    within?: readonly string[];
}): string;
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
export function requestSignInLink(auth: AuthLike, request: Request, link: {
    email: string;
    captchaToken?: string;
    callbackURL: string;
    newUserCallbackURL?: string;
    errorCallbackURL?: string;
}): Promise<{
    status: "sent";
    headers: Headers;
} | {
    status: LinkRefusal;
}>;
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
export function signInWithCode(auth: AuthLike, request: Request, { email, code }: {
    email: string;
    code: string;
}): Promise<{
    status: "signed-in";
    headers: Headers;
} | {
    status: CodeRefusal;
}>;
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
export function signInFormAction(auth: AuthLike, request: Request, form: FormData, site: {
    landing: (next: string) => string;
    newUserLanding?: (next: string) => string;
    errorLanding?: string;
    next?: {
        fallback?: string;
        within?: readonly string[];
    };
}): Promise<{
    location: string;
    headers: Headers;
} | {
    state: SignInFormState;
    status: number;
    headers?: Headers;
}>;
/**
 * Starts a Google or Apple sign-in from the page's form POST (`/auth/google`, `/auth/apple`), so the provider and the
 * landing are decided on the server. Through `auth.handler`, so Better Auth's per-address limiter counts it. Answers the
 * provider's URL and Better Auth's Set-Cookie (its OAuth state), or null when the provider is not set up.
 * @param {AuthLike} auth
 * @param {Request} request
 * @param {{ provider: string, callbackURL: string, newUserCallbackURL?: string, errorCallbackURL: string }} start
 * @returns {Promise<{ location: string, headers: Headers } | null>}
 */
export function startSocialSignIn(auth: AuthLike, request: Request, { provider, callbackURL, newUserCallbackURL, errorCallbackURL }: {
    provider: string;
    callbackURL: string;
    newUserCallbackURL?: string;
    errorCallbackURL: string;
}): Promise<{
    location: string;
    headers: Headers;
} | null>;
/**
 * Better Auth's HTTP surface (/api/auth/*) for a site's route: the handler's answer, marked no-store when it says
 * nothing, since its answers carry sessions and passkey challenges and no browser or proxy may keep one.
 * @param {AuthLike} auth
 * @param {Request} request
 */
export function authHandler(auth: AuthLike, request: Request): Promise<Response>;
export { SIGN_IN_INTENT } from "./sign-in-handler.mjs";
export type AuthLike = import("./sign-in-handler.mjs").AuthLike;
export type LinkRefusal = "limited" | "email-limited" | "check-failed" | "unavailable" | "undeliverable" | "failed";
export type CodeRefusal = "wrong" | "expired" | "spent" | "limited" | "email-limited" | "unavailable" | "disposable" | "other-browser" | "failed";
/**
 * What the sign-in page shows after its action: the address the mail went to (the "Check your inbox" screen with the
 * code box), the email form's error, or the code's error.
 */
export type SignInFormState = {
    sent: string | null;
    error: string | null;
    codeError: string | null;
};
export { ACCOUNT_WORDS, DISPOSABLE_EMAIL, EMAIL_CHANGE_EXPIRES_IN_SECONDS, EMAIL_CHANGE_EXPIRES_IN_WORDS, SIGN_IN_WORDS, emailLinkWords, passkeyErrorWords, securityHistoryWords, signInErrorWords } from "./sign-in-words.mjs";
export { isDisposableEmail, refuseDisposable } from "./sign-in-disposable.mjs";
export { accountFormAction, accountOptions, ACCOUNT_INTENTS } from "./sign-in-account-form.mjs";
