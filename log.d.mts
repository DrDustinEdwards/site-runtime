/** One structured log line per event, and the scrubbers that keep a person's data out of it (log.mjs). */

/** An email address inside any text (global). */
export const EMAIL_PATTERN: RegExp;
/** Stripe secret, restricted and webhook-signing keys (global). */
export const STRIPE_KEY_PATTERN: RegExp;
/** Field names dropped whole: query, header, cookie, arguments. */
export const DROPPED_FIELD: RegExp;

/** `tokenPath`: a global pattern for the site's token routes, the route in group 1; each match becomes `/<route>/[token]`. */
export type ScrubOptions = { tokenPath?: RegExp };

/** `text` with emails, URL queries, Stripe keys, Drizzle parameters and (with `tokenPath`) route tokens cut out. */
export function scrubText(text: string, options?: ScrubOptions): string;
/** A URL or path: query and fragment dropped, then scrubbed as text. */
export function scrubUrl(url: string, options?: ScrubOptions): string;
/** A scrubbed copy of `fields`: strings scrubbed, Errors as "name: message", DROPPED_FIELD keys left out. */
export function scrubFields(fields: Record<string, unknown>, options?: ScrubOptions): Record<string, unknown>;
/** Writes one JSON line, `{ event, ...fields }` scrubbed, at `level` (default "log"). */
export function logEvent(
  event: string,
  fields?: Record<string, unknown>,
  options?: ScrubOptions & { level?: "log" | "warn" | "error" },
): void;
/** `{ request_id, method, path, status?, sha? }` for a log line: `cf-ray` (or ""), the method, the scrubbed pathname. */
export function requestFields(
  request: Request,
  options?: { sha?: string; status?: number } & ScrubOptions,
): { request_id: string; method: string; path: string; status?: number; sha?: string };
/**
 * A fetch handler that writes one `request` line per request: requestFields with status and sha, `route` when
 * `route(request)` names one, and ms. 5xx and throws (as 500, rethrown) at error, 4xx at warn. `sha` is a string or a
 * function of the arguments after the request (`(env) => env.DEPLOY_SHA`). A 400 or 422 also writes an
 * `input_validation_fail` line, unless `inputValidation` is false.
 */
export function withRequestLog<A extends unknown[]>(
  handler: (request: Request, ...rest: A) => Response | Promise<Response>,
  options?: { sha?: string | ((...rest: A) => string | undefined); route?: (request: Request) => string | undefined; inputValidation?: boolean } & ScrubOptions,
): (request: Request, ...rest: A) => Promise<Response>;
/**
 * A `route` namer for withRequestLog from a React Router build's `routes`: the full pattern of the most specific
 * matching route (`/blog/:slug`), a `.data` suffix read as its page; undefined when nothing matches.
 */
export function routeNamer(
  routes: Readonly<Record<string, { path?: string; parentId?: string; index?: boolean } | undefined>>,
): (request: Request) => string | undefined;
/** OWASP Logging Vocabulary event names for sign-in, sessions, account changes, authorization, input validation and rate limiting. */
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
