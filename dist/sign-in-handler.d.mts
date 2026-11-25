/**
 * The headers Better Auth's handler is handed for a signed-out POST: the origin it checks, the address its limiter
 * counts and the user agent; and, for a typed code, the one cookie that says this browser asked for it (CODE_COOKIE,
 * under any prefix), never the browser's other cookies.
 * @param {Request} request
 * @param {{ codeCookie?: boolean }} [options]
 */
export function forwardedHeaders(request: Request, { codeCookie }?: {
    codeCookie?: boolean;
}): Headers;
/** A handler answer's Set-Cookie headers, for the page's own answer. @param {Response} res */
export function setCookies(res: Response): Headers;
/** @param {Response} res */
export function errorCode(res: Response): Promise<string | undefined>;
/** The form field that says the post is a typed code, not a link request. */
export const SIGN_IN_INTENT: "intent";
export function postToHandler(auth: AuthLike, request: Request, path: string, headers: Headers, body: unknown): Promise<Response>;
export type AuthLike = {
    handler: (request: Request) => Promise<Response>;
    options?: {
        baseURL?: unknown;
        basePath?: string;
    };
};
