/**
 * Why an Authorization header does not open an operator door, or null when it does. Unset or shorter than
 * MIN_TOKEN_LENGTH is "not configured" (the door is closed, whatever was sent); a presented token is refused on length
 * before the hash, which an anonymous caller could otherwise ask for in any size. Shared by operatorResponse and
 * ./hono operatorBearer, so both doors hold the same token to the same rules.
 * @param {string | null | undefined} authorization
 * @param {string | undefined} configured
 * @returns {Promise<"not configured" | "not bearer" | "wrong token" | null>}
 */
export function operatorBearerProblem(authorization: string | null | undefined, configured: string | undefined): Promise<"not configured" | "not bearer" | "wrong token" | null>;
/**
 * The operator API's answer to one request.
 *
 * @param {Request} request
 * @param {OperatorOptions} options
 * @returns {Promise<Response>}
 */
export function operatorResponse(request: Request, options: OperatorOptions): Promise<Response>;
/**
 * The caller's side: `POST {tool, args}` to a site's operator route with its bearer, no redirect followed (a redirect is
 * an answer, never a hop to another host with the token). Never throws, and never puts the token in `error`.
 * @param {string} url the site's operator route, such as https://example.com/api/operator
 * @param {string} token
 * @param {string} tool
 * @param {{ args?: Record<string, unknown>, fetch?: typeof fetch, timeoutMs?: number, signal?: AbortSignal, userAgent?: string }} [options]
 *   `signal` replaces the timeout (a caller that joins its own abort to one)
 * @returns {Promise<{ ok: boolean, status: number, data: unknown, error: string | null }>}
 */
export function callOperator(url: string, token: string, tool: string, options?: {
    args?: Record<string, unknown>;
    fetch?: typeof fetch;
    timeoutMs?: number;
    signal?: AbortSignal;
    userAgent?: string;
}): Promise<{
    ok: boolean;
    status: number;
    data: unknown;
    error: string | null;
}>;
/**
 * One tool: what GET lists, and what POST runs with the call's `args` (an object, `{}` when none was sent).
 * @typedef {object} OperatorTool
 * @property {string} description
 * @property {(args: Record<string, unknown>) => unknown} run May answer at once or with a promise.
 */
/**
 * @typedef {object} OperatorOptions
 * @property {string | undefined} token The site's operator secret. Unset or under 32 characters closes the route (503).
 * @property {Parameters<typeof import("./rate-limit/limit.mjs").limit>[0]} limiter The site's rate limiter Durable Object namespace (./rate-limit). Missing refuses every POST (503).
 * @property {Record<string, OperatorTool>} tools
 * @property {string} [limitKey] The limiter key; default "operator".
 * @property {import("./rate-limit/core.mjs").Rule[]} [rules] The limit; default OPERATOR_RULES, 30 a minute.
 */
/**
 * What one call came to: the tool's data on `{ok: true, data}`, else the status and a one-line error without the token.
 * @typedef {object} OperatorCallResult
 * @property {boolean} ok
 * @property {number} status 0 when no answer came.
 * @property {unknown} data
 * @property {string | null} error
 */
export const MIN_TOKEN_LENGTH: 32;
export const OPERATOR_BODY_MAX: number;
export const OPERATOR_RULES: {
    limit: number;
    windowSeconds: number;
}[];
/** A refusal a tool means the caller to read: its message goes back as it is, with a 400. Anything else a tool throws does not. */
export class OperatorError extends Error {
    /** @param {string} message */
    constructor(message: string);
}
/** How long a caller waits for one tool by default: a repair can re-derive a whole store. */
export const OPERATOR_CALL_TIMEOUT_MS: number;
/**
 * One tool: what GET lists, and what POST runs with the call's `args` (an object, `{}` when none was sent).
 */
export type OperatorTool = {
    description: string;
    /**
     * May answer at once or with a promise.
     */
    run: (args: Record<string, unknown>) => unknown;
};
export type OperatorOptions = {
    /**
     * The site's operator secret. Unset or under 32 characters closes the route (503).
     */
    token: string | undefined;
    /**
     * The site's rate limiter Durable Object namespace (./rate-limit). Missing refuses every POST (503).
     */
    limiter: Parameters<typeof import("./rate-limit/limit.mjs").limit>[0];
    tools: Record<string, OperatorTool>;
    /**
     * The limiter key; default "operator".
     */
    limitKey?: string | undefined;
    /**
     * The limit; default OPERATOR_RULES, 30 a minute.
     */
    rules?: import("./rate-limit/core.mjs").Rule[] | undefined;
};
/**
 * What one call came to: the tool's data on `{ok: true, data}`, else the status and a one-line error without the token.
 */
export type OperatorCallResult = {
    ok: boolean;
    /**
     * 0 when no answer came.
     */
    status: number;
    data: unknown;
    error: string | null;
};
