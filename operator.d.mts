/** A site's operator API, the door Capsid reaches a site's operations through (operator.mjs). */
export const MIN_TOKEN_LENGTH: 32;
export const OPERATOR_BODY_MAX: number;
export const OPERATOR_RULES: import("./rate-limit/core.mjs").Rule[];

/** One tool: what GET lists, and what POST runs with the call's `args` (an object, `{}` when none was sent). */
export interface OperatorTool {
  description: string;
  run: (args: Record<string, unknown>) => Promise<unknown> | unknown;
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
