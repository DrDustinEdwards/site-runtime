/**
 * @typedef {{ tokenPath?: RegExp }} ScrubOptions
 *   `tokenPath`: a global pattern for the site's token routes with the route in its first group, such as
 *   `/\/(u|p|invite)\/[^/?#\s'"]+/g`; each match becomes `/<group 1>/[token]`.
 */
/**
 * `text` with emails, URL queries, Stripe keys, Drizzle parameters and (with `tokenPath`) route tokens cut out.
 * @param {string} text
 * @param {ScrubOptions} [options]
 * @returns {string}
 */
export function scrubText(text: string, { tokenPath }?: ScrubOptions): string;
/**
 * A field that holds only a URL or a path: its query and fragment dropped, then scrubbed as text.
 * @param {string} url
 * @param {ScrubOptions} [options]
 * @returns {string}
 */
export function scrubUrl(url: string, options?: ScrubOptions): string;
/**
 * A copy of `fields` with every string scrubbed (as a URL when the key names a url or path), nested objects and arrays
 * walked, Errors turned into their name and message, and the DROPPED_FIELD keys left out.
 * @param {Record<string, unknown>} fields
 * @param {ScrubOptions} [options]
 * @returns {Record<string, unknown>}
 */
export function scrubFields(fields: Record<string, unknown>, options?: ScrubOptions): Record<string, unknown>;
/**
 * Whether an error is the database (or R2, whose transient errors 10001 and 10043 its docs say to retry) being down or
 * reset for a moment, read from the error and its causes.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isDatabaseDown(error: unknown): boolean;
/**
 * The message of a thrown value: an Error's own message, anything else as a string.
 * @param {unknown} error
 * @returns {string}
 */
export function errorMessage(error: unknown): string;
/**
 * Writes one JSON line, `{ event, ...fields }` scrubbed, to the console: `console.error` for `level: "error"`,
 * `console.warn` for "warn", else `console.log`. An error line is also one Sentry report once ./sentry is loaded. A field named `event` cannot replace the event's name.
 * @param {string} event
 * @param {Record<string, unknown>} [fields]
 * @param {ScrubOptions & { level?: "log" | "warn" | "error", report?: boolean }} [options]
 */
export function logEvent(event: string, fields?: Record<string, unknown>, { level, report: reported, ...scrub }?: ScrubOptions & {
    level?: "log" | "warn" | "error";
    report?: boolean;
}): void;
/**
 * Sets what an error line also does beyond the console: ./sentry sets its report here when it is loaded, so ./log
 * itself never loads the SDK (a Worker that never imports ./sentry or ./worker needs no AsyncLocalStorage).
 * @param {(event: string, error: unknown, fields: Record<string, unknown>) => void} reporter
 */
export function reportErrorLines(reporter: (event: string, error: unknown, fields: Record<string, unknown>) => void): void;
/**
 * The pattern for a site's token routes beside the preview link: each match becomes `/<route>/[token]` in a log line,
 * where a page's address would otherwise carry one person's token.
 * @param {readonly string[]} [routes] path prefixes without slashes, such as "u" or "e/c"
 * @returns {RegExp}
 */
export function tokenPattern(routes?: readonly string[]): RegExp;
/**
 * React Router's `handleError` export for entry.server: the framework's default prints every route error to the
 * console, including the "No route matches URL" error of each scanner's 404, an error-level stack trace with no
 * request on it. A 404 is not a failure (the 404 counter in `./not-found` keeps count), nor is any route error
 * response under 500 (RR's 405 for a scanner's POST to a route with no action), so neither is logged here; RR's refusal
 * of a cross-origin action (ACTION_REFUSED) is one warn line, `action_refused`; any other error is one scrubbed `server_error` line at error level with the request's fields, a token route's token cut
 * (`tokenPath`, as tokenPattern builds it; the preview link's by default).
 * @param {ScrubOptions} [options]
 * @returns {(error: unknown, args: { request: Request }) => void}
 */
export function serverErrorHandler({ tokenPath }?: ScrubOptions): (error: unknown, args: {
    request: Request;
}) => void;
/**
 * The status a React Router answer leaves with: 503, with `Retry-After` and `no-store` set on `headers`, when
 * serverErrorHandler saw this request's route fail because D1 or R2 (isDatabaseDown) was down, else `status` unchanged.
 * ./worker's render applies it to every answer of the request handler, a page, a `.data` request and a resource route
 * alike, so a site on siteWorker writes nothing; a site with its own Worker applies it where it calls the handler.
 * Read there because React Router replaces a production route error with a bare "Unexpected Server Error" (a resource
 * route's a plain-text 500, with no hook after it: reactrouter.com/how-to/resource-routes, "Error Handling"), and
 * handleError is the one place that sees the error itself. It is keyed on the request object handleError is given,
 * which is the one passed to the request handler. A 503 tells a crawler and a reader to come back instead of recording
 * a broken page (MDN, 503 Service Unavailable). The error is logged either way.
 * @param {Request} request
 * @param {number} status
 * @param {Headers} headers
 * @returns {number}
 */
export function databaseDownStatus(request: Request, status: number, headers: Headers): number;
/**
 * The fields that tie a log line to its request, for a site to spread into its lines: `request_id` (the `cf-ray`
 * header, empty when there is none), `method`, `path` (scrubbed, never the query) and, when given, the response's
 * `status` and the deployed `sha`.
 * @param {Request} request
 * @param {{ sha?: string, status?: number } & ScrubOptions} [options]
 * @returns {{ request_id: string, method: string, path: string, status?: number, sha?: string }}
 */
export function requestFields(request: Request, { sha, status, ...scrub }?: {
    sha?: string;
    status?: number;
} & ScrubOptions): {
    request_id: string;
    method: string;
    path: string;
    status?: number;
    sha?: string;
};
/**
 * Wraps a Worker's fetch handler so each request writes one `request` line: requestFields with the status, the route
 * (`route(request)` when given, such as the matched pattern, so `/posts/:slug` groups its hits), the ms taken and the
 * sha. A 5xx or a throw is logged at error (a throw as status 500, then rethrown), a 4xx at warn, the rest at log.
 * `sha` is a string or a function of the handler's arguments after the request (`(env) => env.DEPLOY_SHA`).
 * A 400 or 422 (input the site refused) also writes one `input_validation_fail` line (OWASP_EVENTS) with the same
 * request fields and route, unless `inputValidation` is false.
 * @template {unknown[]} A
 * @param {(request: Request, ...rest: A) => Response | Promise<Response>} handler
 * @param {{ sha?: string | ((...rest: A) => string | undefined), route?: (request: Request) => string | undefined, inputValidation?: boolean } & ScrubOptions} [options]
 * @returns {(request: Request, ...rest: A) => Promise<Response>}
 */
export function withRequestLog<A extends unknown[]>(handler: (request: Request, ...rest: A) => Response | Promise<Response>, { sha, route, inputValidation, ...scrub }?: {
    sha?: string | ((...rest: A) => string | undefined);
    route?: (request: Request) => string | undefined;
    inputValidation?: boolean;
} & ScrubOptions): (request: Request, ...rest: A) => Promise<Response>;
/**
 * A `route` namer for withRequestLog from a React Router build's route table (`build.routes`: each route's `path` and
 * `parentId`): the full pattern of the most specific route that matches the path, such as `/blog/:slug`, so a log
 * groups a route's hits whatever the slug. A single-fetch `.data` suffix is read as its page. Static segments outrank
 * params, and params a splat, as in React Router's ranking. Undefined when nothing matches.
 * @param {Readonly<Record<string, { path?: string, parentId?: string, index?: boolean } | undefined>>} routes
 * @returns {(request: Request) => string | undefined}
 */
export function routeNamer(routes: Readonly<Record<string, {
    path?: string;
    parentId?: string;
    index?: boolean;
} | undefined>>): (request: Request) => string | undefined;
export const EMAIL_PATTERN: RegExp;
/** Stripe secret, restricted and webhook-signing keys (redact.mjs SECRET_SHAPES.stripeKey). */
export const STRIPE_KEY_PATTERN: RegExp;
/**
 * Other credentials a failed call can echo (ASVS 16.2.5 and 14.2.4): an Anthropic key, a GitHub token, a signed JWT
 * (a session, an Access or an ID token), the value of a Bearer header, a PEM or PGP private key block (to the end of
 * the text when it is cut off), a Slack token or webhook URL and an AWS access key id. redact.mjs is the stricter
 * reader for text relayed from outside; the shapes both know are its SECRET_SHAPES.
 */
export const CREDENTIAL_PATTERN: RegExp;
/** Field names dropped whole: request headers, cookies, query strings and raw console arguments. */
export const DROPPED_FIELD: RegExp;
/** A preview link's token (Carrel's /preview/<token>), cut from a logged path. */
export const PREVIEW_TOKEN: RegExp;
/** Seconds a reader or crawler is told to wait while D1 is down (`Retry-After`). */
export const DATABASE_DOWN_RETRY_AFTER: 60;
export const handleServerError: (error: unknown, args: {
    request: Request;
}) => void;
/**
 * Event names from the OWASP Logging Vocabulary
 * (https://cheatsheetseries.owasp.org/cheatsheets/Logging_Vocabulary_Cheat_Sheet.html), so a site's security events
 * carry the names a reader or a SIEM rule already knows.
 */
export const OWASP_EVENTS: Readonly<{
    signInSuccess: "authn_login_success";
    signInFailure: "authn_login_fail";
    authorizationFailure: "authz_fail";
    inputValidationFailure: "input_validation_fail";
    rateLimitExceeded: "excess_rate_limit_exceeded";
    signInLinkSent: "authn_token_created";
    signOut: "session_logout";
    sessionExpired: "session_expired";
    userUpdated: "user_updated";
    userDeleted: "user_deleted";
}>;
/**
 * `tokenPath`: a global pattern for the site's token routes with the route in its first group, such as
 * `/\/(u|p|invite)\/[^/?#\s'"]+/g`; each match becomes `/<group 1>/[token]`.
 */
export type ScrubOptions = {
    tokenPath?: RegExp;
};
