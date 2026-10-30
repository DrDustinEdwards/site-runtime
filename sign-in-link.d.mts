/** The emailed link's confirm step: the mailed URL opens a page, and only its POST signs in. Re-exported by `./sign-in`. */

/** Where the mailed link opens unless the site names another page: "/sign-in/confirm". */
export const CONFIRM_PATH: "/sign-in/confirm";

/** The confirm page's URL for Better Auth's /magic-link/verify link: same origin, `confirmPath`, the token and callbacks. */
export function confirmLinkURL(verifyUrl: string, confirmPath: string): string;

/**
 * The confirm page's POST: runs Better Auth's GET /magic-link/verify through `auth.handler` and returns its answer
 * untouched (a redirect with the session's Set-Cookie, a redirect with `?error=`, or 429). Not a POST: 405. No token: 400.
 */
export function confirmSignInLink(
  auth: { handler: (request: Request) => Promise<Response>; options: { basePath?: string; [option: string]: unknown } },
  request: Request,
): Promise<Response>;
