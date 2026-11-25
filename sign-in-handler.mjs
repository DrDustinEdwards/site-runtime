import { CODE_COOKIE } from "./sign-in-link.mjs";

/** The form field that says the post is a typed code, not a link request. */
export const SIGN_IN_INTENT = "intent";

/**
 * @typedef {{ handler: (request: Request) => Promise<Response>, options?: { baseURL?: unknown, basePath?: string } }} AuthLike
 */

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
 * One signed-out POST through Better Auth's handler, never `auth.api`: only the handler runs its per-address limiter.
 * @param {AuthLike} auth @param {Request} request @param {string} path @param {Headers} headers @param {unknown} body
 */
export const postToHandler = (auth, request, path, headers, body) =>
  auth.handler(
    new Request(handlerURL(auth, request, path), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );

/**
 * The headers Better Auth's handler is handed for a signed-out POST: the origin it checks, the address its limiter
 * counts and the user agent; and, for a typed code, the one cookie that says this browser asked for it (CODE_COOKIE,
 * under any prefix), never the browser's other cookies.
 * @param {Request} request
 * @param {{ codeCookie?: boolean }} [options]
 */
export function forwardedHeaders(request, { codeCookie = false } = {}) {
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const name of ["origin", "cf-connecting-ip", "user-agent"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (codeCookie) {
    const held = (request.headers.get("cookie") ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.split("=")[0].endsWith(`.${CODE_COOKIE}`));
    if (held.length) headers.set("cookie", held.join("; "));
  }
  return headers;
}

/** A handler answer's Set-Cookie headers, for the page's own answer. @param {Response} res */
export function setCookies(res) {
  const headers = new Headers();
  for (const cookie of res.headers.getSetCookie()) headers.append("Set-Cookie", cookie);
  return headers;
}

/** @param {Response} res */
export async function errorCode(res) {
  const body = /** @type {{ code?: unknown }} */ (
    await res
      .clone()
      .json()
      .catch(() => ({}))
  );
  return typeof body.code === "string" ? body.code : undefined;
}
