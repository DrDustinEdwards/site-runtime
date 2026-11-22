/**
 * The confirm page's URL for Better Auth's link: the link's origin, `confirmPath`, the link's token and callbacks, and
 * `sent`, the time it was mailed.
 * @param {string} verifyUrl Better Auth's /magic-link/verify URL
 * @param {string} confirmPath
 * @param {number} [sentAt] epoch ms, now by default
 */
export function confirmLinkURL(verifyUrl: string, confirmPath: string, sentAt?: number): string;
/**
 * The confirm page's POST: runs Better Auth's GET /magic-link/verify through `auth.handler` and returns its answer
 * untouched: a redirect to callbackURL with the session's Set-Cookie, a redirect to errorCallbackURL with `?error=`
 * for a spent, expired or unknown token, or 429. A spent link comes back to errorCallbackURL, else to this page, with
 * `sent` carried along, so `signInLinkProblem` can say whether it was used or ran out. Anything but a POST is 405 and
 * signs nobody in; no token is 400.
 * @param {{ handler: (request: Request) => Promise<Response>, options: { basePath?: string, [option: string]: unknown } }} auth
 * @param {Request} request
 */
export function confirmSignInLink(auth: {
    handler: (request: Request) => Promise<Response>;
    options: {
        basePath?: string;
        [option: string]: unknown;
    };
}, request: Request): Promise<Response>;
/**
 * @typedef {"signed-in" | "used" | "expired" | "invalid" | "missing" | "disposable" | "failed"} SignInLinkProblem
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
 * - "disposable": a new account at a disposable address (refuseDisposable), which a new link would not change;
 * - "failed": any other error (the account could not be made, the session could not be written).
 * @param {string | URL} url the page's URL
 * @param {{ signedIn?: boolean, now?: number }} [options]
 * @returns {SignInLinkProblem | null}
 */
export function signInLinkProblem(url: string | URL, { signedIn, now }?: {
    signedIn?: boolean;
    now?: number;
}): SignInLinkProblem | null;
/**
 * The page an email-change link opens, for Better Auth's link: the link's origin, `confirmPath`, and the token alone
 * (the page sets its own callback when it posts). For both mails: `user.changeEmail.sendChangeEmailConfirmation`'s
 * `url` (to the current address) and `emailVerification.sendVerificationEmail`'s (to the new one).
 * @param {string} verifyUrl Better Auth's /verify-email URL
 * @param {string} [confirmPath]
 */
export function emailConfirmURL(verifyUrl: string, confirmPath?: string): string;
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
export function confirmEmailLink(auth: {
    handler: (request: Request) => Promise<Response>;
    options: {
        basePath?: string;
        [option: string]: unknown;
    };
}, request: Request, { callbackURL }?: {
    callbackURL?: string;
}): Promise<Response>;
/**
 * What the email-change page shows, from its URL: `{ done }` after a confirmation ("approved", "changed" or
 * "verified"), `{ problem }` after a refusal ("expired", "done" for a change made already, "other-account" when this
 * browser is signed in to another account, "invalid", "failed") or for a page with no token ("missing"), and
 * `{ done: null, problem: null }` for the page with its button.
 * @param {string | URL} url
 * @returns {{ done: "approved" | "changed" | "verified" | null, problem: EmailLinkProblem | null }}
 */
export function emailLinkResult(url: string | URL): {
    done: "approved" | "changed" | "verified" | null;
    problem: EmailLinkProblem | null;
};
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
/** Better Auth's error code when a new account's address is at a disposable domain (`./sign-in-form` refuseDisposable). */
export const DISPOSABLE_EMAIL: "disposable_email";
/**
 * The error code (422) when a sign-in mail is refused because Email Service has the address on its suppression list
 * (`./email` RECIPIENT_SUPPRESSED): mail to it bounced or was reported as spam, so no link or code can reach it.
 */
export const UNDELIVERABLE_EMAIL: "undeliverable_email";
/** Where the email-change links open unless the site names another page: "/email/confirm" (Foxhound's). */
export const EMAIL_CONFIRM_PATH: "/email/confirm";
/**
 * How long a sign-in link and its code work: 10 minutes, NIST SP 800-63B-4's limit for an out-of-band sign-in ("the
 * authentication SHALL be considered invalid unless completed within 10 minutes", pages.nist.gov/800-63-4, read
 * 2026-10-31). Better Auth's default is 5, which ran out while a person found the mail and came back (Foxhound's live
 * test, 2026-10-29).
 */
export const SIGN_IN_EXPIRES_IN_SECONDS: number;
/**
 * The cookie that ties a sign-in code to the browser that asked for it (`./sign-in`'s codeBrowser): Better Auth's
 * signed cookie under its prefix, so `better-auth.code_browser` (`__Secure-` on https). A site whose server posts the
 * code for the browser (`./sign-in-form`) passes this one cookie through, and the mail's link is not tied to it.
 */
export const CODE_COOKIE: "code_browser";
/** The same, in words, for the mail and the page that says a link was sent. */
export const SIGN_IN_EXPIRES_IN_WORDS: "10 minutes";
/**
 * What the confirm page says for each problem: a title and a sentence, the action being "send yourself a new link".
 * @type {Readonly<Record<SignInLinkProblem, Readonly<{ title: string; text?: string }>>>}
 */
export const SIGN_IN_LINK_WORDS: Readonly<Record<SignInLinkProblem, Readonly<{
    title: string;
    text?: string;
}>>>;
export type SignInLinkProblem = "signed-in" | "used" | "expired" | "invalid" | "missing" | "disposable" | "failed";
export type EmailLinkProblem = "expired" | "done" | "other-account" | "invalid" | "missing" | "failed";
export { CONFIRM_PATH, SIGN_IN_PATH } from "./sign-in-path.mjs";
