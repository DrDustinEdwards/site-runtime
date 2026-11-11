/** RFC 9457 problem details, the one error answer every site's JSON API gives (http-errors.mjs). */

export const PROBLEM_TYPE: string;

/** An error a route throws for the caller to see. */
export class AppError extends Error {
  constructor(status: number, code: string, message: string, extensions?: Record<string, unknown>);
  status: number;
  code: string;
  extensions: Record<string, unknown> | undefined;
}

/** The common refusals, with the codes and sentences the sites share. */
export const errors: {
  unauthorized(message?: string): AppError;
  forbidden(message?: string): AppError;
  notFound(message?: string): AppError;
  methodNotAllowed(message?: string): AppError;
  conflict(message: string): AppError;
  gone(message?: string): AppError;
  tooLarge(message?: string): AppError;
  unsupportedType(message?: string): AppError;
  validation(problems?: unknown, message?: string): AppError;
  rateLimited(message?: string): AppError;
  serviceUnavailable(message?: string): AppError;
};

/** A problem details answer, uncacheable; `type` is about:blank unless `typeBase` is given. */
export function problemResponse(problem: {
  status: number;
  code: string;
  detail: string;
  typeBase?: string;
  title?: string;
  instance?: string;
  extensions?: Record<string, unknown>;
  headers?: HeadersInit;
}): Response;

/** Whether an error carries a 4xx/5xx `status` and a string `code`. */
export function isKnownError(
  error: unknown,
): error is { status: number; code: string; message: string; extensions?: Record<string, unknown> };

/** The answer for anything a route threw: known errors as they say, schema errors as 422, the rest logged and 500. */
export function errorResponse(
  error: unknown,
  options?: { typeBase?: string; requestId?: string; event?: string; instance?: string },
): Response;

/** A validator's issues as `{ path, message }`. */
export function schemaIssues(issues: unknown[]): { path: string; message: string }[];

/** Hono's `app.onError` handler over errorResponse, with no Hono import. */
export function honoErrorHandler(options?: {
  typeBase?: string;
  event?: string;
}): (error: Error, c: { get?: (key: string) => unknown }) => Response;

/** The problem a client got back: `code`, `detail` and the extension members. */
export function readProblem(
  body: unknown,
  fallback: string,
): { code: string; detail: string; status?: number; extensions: Record<string, unknown> };
