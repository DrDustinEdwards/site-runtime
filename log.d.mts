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
/** `{ request_id, method, path, sha? }` for a log line: `cf-ray` (or ""), the method, the scrubbed pathname. */
export function requestFields(
  request: Request,
  options?: { sha?: string } & ScrubOptions,
): { request_id: string; method: string; path: string; sha?: string };
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
