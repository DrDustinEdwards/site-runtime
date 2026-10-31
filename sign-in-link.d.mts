/**
 * The emailed links' confirm steps (sign-in-link.mjs): each mailed URL opens a page of the site's own, and only its POST
 * acts. The sign-in link, and the email change's two links. Re-exported by `./sign-in`.
 */

/** Where the mailed sign-in link opens unless the site names another page: "/sign-in/confirm". */
export const CONFIRM_PATH: "/sign-in/confirm";
/** Where the email-change links open unless the site names another page: "/email/confirm". */
export const EMAIL_CONFIRM_PATH: "/email/confirm";
/** How long a sign-in link and its code work: 10 minutes. */
export const SIGN_IN_EXPIRES_IN_SECONDS: number;
/** The same, in words: "10 minutes". */
export const SIGN_IN_EXPIRES_IN_WORDS: string;

/** The confirm page's URL for Better Auth's /magic-link/verify link: same origin, `confirmPath`, the token, callbacks and `sent`. */
export function confirmLinkURL(verifyUrl: string, confirmPath: string, sentAt?: number): string;

/**
 * The confirm page's POST: runs Better Auth's GET /magic-link/verify through `auth.handler` and returns its answer
 * untouched (a redirect with the session's Set-Cookie, a redirect with `?error=` and `sent` to errorCallbackURL or this
 * page, or 429). Not a POST: 405. No token: 400.
 */
export function confirmSignInLink(
  auth: { handler: (request: Request) => Promise<Response>; options: { basePath?: string; [option: string]: unknown } },
  request: Request,
): Promise<Response>;

export type SignInLinkProblem = "signed-in" | "used" | "expired" | "invalid" | "missing" | "failed";
/** What went wrong with a sign-in link, from the confirm page's URL (`error`, `sent`, `token`), or null for the button. */
export function signInLinkProblem(url: string | URL, options?: { signedIn?: boolean; now?: number }): SignInLinkProblem | null;
/** The confirm page's words for each problem. */
export const SIGN_IN_LINK_WORDS: Readonly<Record<SignInLinkProblem, Readonly<{ title: string; text: string }>>>;

/** The page an email-change link opens: Better Auth's link's origin, `confirmPath` (EMAIL_CONFIRM_PATH) and the token. */
export function emailConfirmURL(verifyUrl: string, confirmPath?: string): string;

/**
 * The email-change page's POST: runs Better Auth's GET /verify-email through `auth.handler` and returns its redirect to
 * `callbackURL` (the page by default) with `done=approved|changed|verified`, or with `error=`; or 429. Not a POST: 405.
 * No token: 400.
 */
export function confirmEmailLink(
  auth: { handler: (request: Request) => Promise<Response>; options: { basePath?: string; [option: string]: unknown } },
  request: Request,
  options?: { callbackURL?: string },
): Promise<Response>;

export type EmailLinkProblem = "expired" | "done" | "other-account" | "invalid" | "missing" | "failed";
/** What the email-change page shows, from its URL: `done` after a confirmation, `problem` after a refusal or with no token. */
export function emailLinkResult(url: string | URL): { done: "approved" | "changed" | "verified" | null; problem: EmailLinkProblem | null };
