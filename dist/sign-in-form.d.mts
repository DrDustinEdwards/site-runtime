/**
 * True when the address is at a disposable (throwaway) domain or a subdomain of one, from the list in
 * `./disposable-domains.mjs` (update-disposable.mjs, from disposable-email-domains, CC0).
 * @param {string} email
 */
export function isDisposableEmail(email: string): boolean;
/**
 * The before hook on a new user that refuses a disposable address, whichever way the account is made (link, code,
 * Google, Apple). An existing account keeps working. `signInOptions` puts it in `databaseHooks.user.create`.
 * @param {{ email: string }} user
 */
export function refuseDisposable(user: {
    email: string;
}): Promise<void>;
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
export function safeNextPath(raw: unknown, { fallback, within }?: {
    fallback?: string;
    within?: readonly string[];
}): string;
/**
 * @typedef {{ handler: (request: Request) => Promise<Response>, options?: { baseURL?: unknown, basePath?: string } }} AuthLike
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
 * Starts a Google or Apple sign-in from the page's form POST (`/auth/google`, `/auth/apple`), so the provider, the
 * landing and the state cookie are all decided on the server, never by a client-side call. Answers the provider's
 * URL and Better Auth's Set-Cookie (its OAuth state), or null when the provider is not set up.
 * @param {AuthLike & { api: { signInSocial: (input: { body: { provider: string, callbackURL: string, newUserCallbackURL: string, errorCallbackURL: string }, headers: Headers, asResponse: true }) => Promise<Response> } }} auth
 * @param {Request} request
 * @param {{ provider: string, callbackURL: string, newUserCallbackURL?: string, errorCallbackURL: string }} start
 * @returns {Promise<{ location: string, headers: Headers } | null>}
 */
export function startSocialSignIn(auth: AuthLike & {
    api: {
        signInSocial: (input: {
            body: {
                provider: string;
                callbackURL: string;
                newUserCallbackURL: string;
                errorCallbackURL: string;
            };
            headers: Headers;
            asResponse: true;
        }) => Promise<Response>;
    };
}, request: Request, { provider, callbackURL, newUserCallbackURL, errorCallbackURL }: {
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
export function accountOptions({ confirmPath, sendEmailChange, beforeDelete, afterDelete }: {
    confirmPath: string;
    sendEmailChange: SendEmailChange;
    beforeDelete: (user: {
        id: string;
        email: string;
    }) => Promise<void>;
    afterDelete?: (user: {
        id: string;
        email: string;
    }) => Promise<void>;
}): {
    disabledPaths: string[];
    user: {
        changeEmail: {
            enabled: boolean;
            /** @param {{ user: { email: string }, newEmail: string, url: string, token: string }} data */
            sendChangeEmailConfirmation: ({ user, newEmail, url, token }: {
                user: {
                    email: string;
                };
                newEmail: string;
                url: string;
                token: string;
            }) => Promise<void>;
        };
        deleteUser: {
            enabled: boolean;
            beforeDelete: (user: {
                id: string;
                email: string;
            }) => Promise<void>;
            afterDelete: ((user: {
                id: string;
                email: string;
            }) => Promise<void>) | undefined;
        };
    };
    emailVerification: {
        expiresIn: number;
        /** @param {{ user: { email: string }, url: string, token: string }} data */
        sendVerificationEmail: ({ user, url, token }: {
            user: {
                email: string;
            };
            url: string;
            token: string;
        }) => Promise<void>;
    };
};
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
export function accountFormAction(auth: {
    api: AccountApi;
}, request: Request, form: FormData, site: {
    deletedLanding: string;
    beforeDelete?: (user: AccountUser, form: FormData) => Promise<string | null | undefined>;
}): Promise<{
    location: string;
    headers: Headers;
} | {
    state: AccountFormState;
    status: number;
} | null>;
/** The form field that says the post is a typed code, not a link request. */
export const SIGN_IN_INTENT: "intent";
/** The account page's posts `accountFormAction` answers, by their `intent` field. */
export const ACCOUNT_INTENTS: readonly ["change-email", "sign-out-device", "delete-account"];
export type AuthLike = {
    handler: (request: Request) => Promise<Response>;
    options?: {
        baseURL?: unknown;
        basePath?: string;
    };
};
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
export type SendEmailChange = (mail: {
    to: string;
    link: string;
    token: string;
    step: "current" | "new";
    newEmail?: string;
    expiresIn: string;
}) => Promise<void> | void;
export type AccountUser = {
    id: string;
    email: string;
    emailVerified?: boolean;
};
export type AccountApi = {
    getSession(o: import("./sign-in-account.mjs").SessionLookup): Promise<{
        session: {
            createdAt: Date | string;
            token: string;
        };
        user: AccountUser;
    } | null>;
    listSessions(o: {
        headers: Headers;
    }): Promise<import("./sign-in-account.mjs").SessionRow[]>;
    revokeSession(o: {
        headers: Headers;
        body: {
            token: string;
        };
    }): Promise<unknown>;
    changeEmail(o: {
        headers: Headers;
        body: {
            newEmail: string;
        };
    }): Promise<unknown>;
    deleteUser(o: {
        headers: Headers;
        body: Record<string, never>;
        asResponse: true;
    }): Promise<Response>;
};
/**
 * What the account page shows after one of its posts: which post (`intent`), whether it worked, the error words, and
 * `stale` when it needs a sign-in from the last FRESH_SECONDS first; `sentTo` is the current address the first
 * email-change link went to.
 */
export type AccountFormState = {
    intent: string;
    ok: boolean;
    error: string | null;
    stale: boolean;
    sentTo: string | null;
};
export { ACCOUNT_WORDS, DISPOSABLE_EMAIL, EMAIL_CHANGE_EXPIRES_IN_SECONDS, EMAIL_CHANGE_EXPIRES_IN_WORDS, SIGN_IN_WORDS, emailLinkWords, passkeyErrorWords, securityHistoryWords, signInErrorWords } from "./sign-in-words.mjs";
