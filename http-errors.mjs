/**
 * The one error answer every site's JSON API gives: RFC 9457 problem details (`application/problem+json`), with the
 * machine-readable `code` as an extension member. site-api already answers this way; Foxing's `{ error: { code,
 * message } }` envelope moves onto it (the 2026-11-11 shared-code audit, item 41a; Dustin approved RFC 9457).
 *
 * A body looks like `{ type, title, status, detail, code, ...extensions }`. `type` is "about:blank" unless the site
 * passes a `typeBase` (a page that explains each code, the code appended), and then `title` is the HTTP status phrase,
 * as RFC 9457 section 4.2.1 asks. A client reads `code` to branch and `detail` to show.
 *
 * Framework-free: a Hono app, a React Router action and a bare Worker all throw an AppError and answer with
 * errorResponse. Any thrown error with a numeric `status` and a string `code` (a domain error from a shared core
 * package, Hono's HTTPException with a code) is answered the same way, and a schema error that carries `issues` (zod,
 * Valibot, any Standard Schema validator) is a 422 `validation` with the issues as `errors`, without importing any of
 * them.
 */

import { logEvent } from "./log.mjs";

/** The content type of every problem answer. */
const PROBLEM_TYPE = "application/problem+json; charset=utf-8";

/** The status phrases a problem's `title` takes when its `type` is about:blank. */
const PHRASES = /** @type {Record<number, string>} */ ({
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  410: "Gone",
  413: "Content Too Large",
  415: "Unsupported Media Type",
  422: "Unprocessable Content",
  429: "Too Many Requests",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
});

/** An error a route throws for the caller to see: its status, a stable code, the sentence shown and extra members. */
export class AppError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [extensions] extra problem members, such as `errors` or `resets_at`
   */
  constructor(status, code, message, extensions) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.extensions = extensions;
  }
}

/** The common refusals, with the codes and sentences the sites share. */
export const errors = {
  unauthorized: (message = "Sign in required.") => new AppError(401, "unauthorized", message),
  forbidden: (message = "Not allowed.") => new AppError(403, "forbidden", message),
  notFound: (message = "Not found.") => new AppError(404, "not_found", message),
  methodNotAllowed: (message = "Method not allowed.") =>
    new AppError(405, "method_not_allowed", message),
  /** @param {string} message */
  conflict: (message) => new AppError(409, "conflict", message),
  gone: (message = "Gone.") => new AppError(410, "gone", message),
  tooLarge: (message = "Request body too large.") => new AppError(413, "too_large", message),
  unsupportedType: (message = "Send the body as application/json.") =>
    new AppError(415, "unsupported_type", message),
  /** @param {unknown} [problems] the validator's issues, answered as `errors` */
  validation: (problems, message = "Invalid request.") =>
    new AppError(
      422,
      "validation",
      message,
      problems === undefined ? undefined : { errors: problems },
    ),
  rateLimited: (message = "Too many requests.") => new AppError(429, "rate_limited", message),
  serviceUnavailable: (message = "Temporarily unavailable.") =>
    new AppError(503, "unavailable", message),
};

/**
 * A problem details answer, uncacheable.
 * @param {{ status: number, code: string, detail: string, typeBase?: string, title?: string, instance?: string,
 *   extensions?: Record<string, unknown>, headers?: HeadersInit }} problem
 * @returns {Response}
 */
export function problemResponse({
  status,
  code,
  detail,
  typeBase,
  title,
  instance,
  extensions,
  headers,
}) {
  const type = typeBase ? `${typeBase}${code}` : "about:blank";
  const body = {
    ...extensions,
    type,
    title: title ?? PHRASES[status] ?? "Error",
    status,
    detail,
    code,
    ...(instance ? { instance } : {}),
  };
  const answer = new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": PROBLEM_TYPE,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
  for (const [name, value] of new Headers(headers)) answer.headers.set(name, value);
  return answer;
}

/**
 * Whether an error carries an answer of its own: a whole-number 4xx/5xx `status` and a string `code`.
 * @param {unknown} error
 * @returns {error is { status: number, code: string, message: string, extensions?: Record<string, unknown> }}
 */
function isKnownError(error) {
  if (!error || typeof error !== "object") return false;
  const { status, code } = /** @type {{ status?: unknown, code?: unknown }} */ (error);
  return (
    typeof code === "string" &&
    code !== "" &&
    typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 400 &&
    status <= 599
  );
}

/**
 * A schema validator's failure: anything with an `issues` array (zod's ZodError, Valibot, a Standard Schema result).
 * @param {unknown} error
 * @returns {error is { issues: unknown[] }}
 */
function isSchemaError(error) {
  return (
    !!error &&
    typeof error === "object" &&
    Array.isArray(/** @type {{ issues?: unknown }} */ (error).issues)
  );
}

/**
 * The answer for anything a route threw. A known error (AppError, a domain error, an HTTPException with a code) is
 * answered as it says; a schema error is 422 `validation` with its issues (path and message only) as `errors`; a
 * thrown Response is passed on as it is (site-runtime ./body throws its 413 and 415 that way); anything else is logged
 * under `event` (default "api_unhandled") with the request id and answered 500 `internal` without its message.
 * @param {unknown} error
 * @param {{ typeBase?: string, requestId?: string, event?: string, instance?: string }} [options]
 * @returns {Response}
 */
export function errorResponse(
  error,
  { typeBase, requestId, event = "api_unhandled", instance } = {},
) {
  if (error instanceof Response) return error;
  if (isKnownError(error)) {
    return problemResponse({
      status: error.status,
      code: error.code,
      detail: error.message,
      typeBase,
      instance,
      extensions: error.extensions,
    });
  }
  if (isSchemaError(error)) {
    return problemResponse({
      status: 422,
      code: "validation",
      detail: "Invalid request.",
      typeBase,
      instance,
      extensions: { errors: schemaIssues(error.issues) },
    });
  }
  logEvent(event, { request_id: requestId, error }, { level: "error" });
  return problemResponse({
    status: 500,
    code: "internal",
    detail: "Something went wrong.",
    typeBase,
    instance,
  });
}

/**
 * A validator's issues as `{ path, message }`, the path joined with dots: what a client needs to mark a field, and
 * nothing of the value that failed.
 * @param {unknown[]} issues
 * @returns {{ path: string, message: string }[]}
 */
export function schemaIssues(issues) {
  return issues.map((issue) => {
    const { path, message } = /** @type {{ path?: unknown, message?: unknown }} */ (issue ?? {});
    const parts = Array.isArray(path)
      ? path.map((part) =>
          part && typeof part === "object" && "key" in part ? String(part.key) : String(part),
        )
      : [];
    return { path: parts.join("."), message: typeof message === "string" ? message : "Invalid." };
  });
}

/**
 * Hono's `app.onError(...)` handler over errorResponse, with no Hono import: the request id is read from the
 * context's `requestId` variable when the app sets one.
 * @param {{ typeBase?: string, event?: string }} [options]
 * @returns {(error: Error, c: { get?: (key: string) => unknown }) => Response}
 */
export function honoErrorHandler(options = {}) {
  return (error, c) => {
    const requestId = c.get?.("requestId");
    return errorResponse(error, {
      ...options,
      requestId: typeof requestId === "string" ? requestId : undefined,
    });
  };
}

/**
 * The problem a client got back, read from a failed fetch's body: `code`, `detail` and the extension members. A body
 * that is not problem JSON is `{ code: "http_error", detail: fallback }`.
 * @param {unknown} body the parsed JSON body, or anything else
 * @param {string} fallback the sentence to show when the body says none
 * @returns {{ code: string, detail: string, status?: number, extensions: Record<string, unknown> }}
 */
export function readProblem(body, fallback) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return { code: "http_error", detail: fallback, extensions: {} };
  const {
    type: _type,
    title: _title,
    status,
    detail,
    code,
    instance: _instance,
    ...extensions
  } = /** @type {Record<string, unknown>} */ (body);
  return {
    code: typeof code === "string" && code ? code : "http_error",
    detail: typeof detail === "string" && detail ? detail : fallback,
    ...(typeof status === "number" ? { status } : {}),
    extensions,
  };
}
