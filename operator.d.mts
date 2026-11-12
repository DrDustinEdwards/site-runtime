/** A site's operator API, the door Capsid reaches a site's operations through (operator.mjs). */
export const MIN_TOKEN_LENGTH: 32;
export const OPERATOR_BODY_MAX: number;
export const OPERATOR_RULES: import("./rate-limit/core.mjs").Rule[];

/** Thrown by a tool to refuse with a message the caller should read (answered 400). Any other throw is answered "The tool failed (ref ...)" and logged. */
export class OperatorError extends Error {
  constructor(message: string);
}

/** One tool: what GET lists, and what POST runs with the call's `args` (an object, `{}` when none was sent). */
export interface OperatorTool {
  description: string;
  /** May answer at once or with a promise. */
  run: (args: Record<string, unknown>) => unknown;
}

export interface OperatorOptions {
  /** The site's operator secret. Unset or under 32 characters closes the route (503). */
  token: string | undefined;
  /** The site's rate limiter Durable Object namespace (./rate-limit). Missing refuses every POST (503). */
  limiter: Parameters<typeof import("./rate-limit/limit.mjs").limit>[0];
  tools: Record<string, OperatorTool>;
  /** The limiter key; default "operator". */
  limitKey?: string;
  /** The limit; default OPERATOR_RULES, 30 a minute. */
  rules?: import("./rate-limit/core.mjs").Rule[];
}

/** GET lists the tools, POST {tool, args} runs one; both behind the bearer. Never throws. */
export function operatorResponse(request: Request, options: OperatorOptions): Promise<Response>;

/** How long callOperator waits by default: five minutes. */
export const OPERATOR_CALL_TIMEOUT_MS: number;
/** What one call came to: the tool's data on `{ok: true, data}`, else the status and a one-line error without the token. */
export interface OperatorCallResult {
  ok: boolean;
  /** 0 when no answer came. */
  status: number;
  data: unknown;
  error: string | null;
}
/** The caller's side: POST {tool, args} with the bearer, no redirect followed, a timeout. Never throws. */
export function callOperator(
  url: string,
  token: string,
  tool: string,
  options?: {
    args?: Record<string, unknown>;
    fetch?: typeof fetch;
    timeoutMs?: number;
    /** Used in place of the timeout, for a caller that joins its own abort to one. */
    signal?: AbortSignal;
    userAgent?: string;
  },
): Promise<OperatorCallResult>;
