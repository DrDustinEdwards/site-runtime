/**
 * A problem details answer, uncacheable.
 * @param {{ status: number, code: string, detail: string, typeBase?: string, title?: string, instance?: string,
 *   extensions?: Record<string, unknown>, headers?: HeadersInit }} problem
 * @returns {Response}
 */
export function problemResponse({ status, code, detail, typeBase, title, instance, extensions, headers, }: {
    status: number;
    code: string;
    detail: string;
    typeBase?: string;
    title?: string;
    instance?: string;
    extensions?: Record<string, unknown>;
    headers?: HeadersInit;
}): Response;
/**
 * The answer for anything a route threw. A known error (AppError, a domain error, an HTTPException with a code) is
 * answered as it says; a schema error is 422 `validation` with its issues (path and message only) as `errors`; a
 * thrown Response is passed on as it is (site-runtime ./body throws its 413 and 415 that way); anything else is logged
 * under `event` (default "api_unhandled") with the request id and answered 500 `internal` without its message.
 * @param {unknown} error
 * @param {{ typeBase?: string, requestId?: string, event?: string, instance?: string }} [options]
 * @returns {Response}
 */
export function errorResponse(error: unknown, { typeBase, requestId, event, instance }?: {
    typeBase?: string;
    requestId?: string;
    event?: string;
    instance?: string;
}): Response;
/**
 * A validator's issues as `{ path, message }`, the path joined with dots: what a client needs to mark a field, and
 * nothing of the value that failed.
 * @param {unknown[]} issues
 * @returns {{ path: string, message: string }[]}
 */
export function schemaIssues(issues: unknown[]): {
    path: string;
    message: string;
}[];
/**
 * Hono's `app.onError(...)` handler over errorResponse, with no Hono import: the request id is read from the
 * context's `requestId` variable when the app sets one.
 * @param {{ typeBase?: string, event?: string }} [options]
 * @returns {(error: Error, c: { get?: (key: string) => unknown }) => Response}
 */
export function honoErrorHandler(options?: {
    typeBase?: string;
    event?: string;
}): (error: Error, c: {
    get?: (key: string) => unknown;
}) => Response;
/**
 * The problem a client got back, read from a failed fetch's body: `code`, `detail` and the extension members. A body
 * that is not problem JSON is `{ code: "http_error", detail: fallback }`.
 * @param {unknown} body the parsed JSON body, or anything else
 * @param {string} fallback the sentence to show when the body says none
 * @returns {{ code: string, detail: string, status?: number, extensions: Record<string, unknown> }}
 */
export function readProblem(body: unknown, fallback: string): {
    code: string;
    detail: string;
    status?: number;
    extensions: Record<string, unknown>;
};
/** An error a route throws for the caller to see: its status, a stable code, the sentence shown and extra members. */
export class AppError extends Error {
    /**
     * @param {number} status
     * @param {string} code
     * @param {string} message
     * @param {Record<string, unknown>} [extensions] extra problem members, such as `errors` or `resets_at`
     */
    constructor(status: number, code: string, message: string, extensions?: Record<string, unknown>);
    status: number;
    code: string;
    extensions: Record<string, unknown> | undefined;
}
export namespace errors {
    function unauthorized(message?: string): AppError;
    function forbidden(message?: string): AppError;
    function notFound(message?: string): AppError;
    function methodNotAllowed(message?: string): AppError;
    function conflict(message: string): AppError;
    function gone(message?: string): AppError;
    function tooLarge(message?: string): AppError;
    function unsupportedType(message?: string): AppError;
    function validation(problems?: unknown, message?: string): AppError;
    function rateLimited(message?: string): AppError;
    function serviceUnavailable(message?: string): AppError;
}
