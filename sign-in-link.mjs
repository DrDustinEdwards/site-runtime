/**
 * The emailed link's confirm step, apart from `./sign-in` so it needs no Better Auth import (and `npm test` covers it
 * without one); `./sign-in` re-exports it. Better Auth's link is GET /magic-link/verify, which signs in on the GET, so a
 * mail scanner that opens every link spends it, or signs itself in. The mail instead carries a page of the site's own
 * (CONFIRM_PATH) with one button; only that button's POST runs the verify.
 */

/** Where the mailed link opens unless the site names another page: "/sign-in/confirm". */
export const CONFIRM_PATH = "/sign-in/confirm";

/** The verify endpoint's query parameters, carried from Better Auth's link to the page and back. */
const LINK_PARAMS = ["token", "callbackURL", "newUserCallbackURL", "errorCallbackURL"];

/**
 * The confirm page's URL for Better Auth's link: the link's origin, `confirmPath`, and the link's token and callbacks.
 * @param {string} verifyUrl Better Auth's /magic-link/verify URL
 * @param {string} confirmPath
 */
export function confirmLinkURL(verifyUrl, confirmPath) {
  const verify = new URL(verifyUrl);
  const page = new URL(confirmPath, verify.origin);
  for (const name of LINK_PARAMS) {
    const value = verify.searchParams.get(name);
    if (value !== null) page.searchParams.set(name, value);
  }
  return page.toString();
}

/**
 * The confirm page's POST: runs Better Auth's GET /magic-link/verify through `auth.handler`, so its limiter and checks
 * run as for any request, and returns its answer untouched: a redirect to callbackURL with the session's Set-Cookie, a
 * redirect to errorCallbackURL with `?error=` for a spent, expired or unknown token, or 429. Anything but a POST is 405
 * and signs nobody in. The parameters come from the POST's own URL (a form with no action posts to the page's URL,
 * query and all), else from its form fields.
 * @param {{ handler: (request: Request) => Promise<Response>, options: { basePath?: string, [option: string]: unknown } }} auth
 * @param {Request} request
 */
export async function confirmSignInLink(auth, request) {
  const noStore = { "Cache-Control": "no-store" };
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...noStore, Allow: "POST" } });
  const posted = new URL(request.url);
  /** @type {{ get(name: string): unknown }} */
  let params = posted.searchParams;
  if (!posted.searchParams.get("token")) {
    params = (await request.clone().formData().catch(() => null)) ?? new URLSearchParams();
  }
  const verify = new URL(`${auth.options.basePath || "/api/auth"}/magic-link/verify`, posted.origin);
  for (const name of LINK_PARAMS) {
    const value = params.get(name);
    if (typeof value === "string" && value) verify.searchParams.set(name, value);
  }
  if (!verify.searchParams.get("token")) return new Response(null, { status: 400, headers: noStore });
  // Without a callbackURL Better Auth answers with the session token as JSON instead of a redirect.
  if (!verify.searchParams.get("callbackURL")) verify.searchParams.set("callbackURL", "/");
  const headers = new Headers(request.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  return auth.handler(new Request(verify, { method: "GET", headers }));
}
