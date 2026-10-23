/** The admin MCP servers' shared scaffold: era router, API leg, door rate limit and scope check (mcp-server.mjs). */

/** One request routed to the era that can answer it; omit `isLegacyRequest` for a modern-only server. */
export function routeMcpEra<F, O extends object, E, C>(
  request: Request,
  env: E,
  ctx: C,
  sdk: {
    factory: F;
    options: O;
    createMcpHandler: (factory: F, options: O & { legacy: "stateless" | "reject" }) => (request: Request, env: E, ctx: C) => Promise<Response>;
    isLegacyRequest?: (request: Request) => Promise<boolean> | boolean;
  },
): Promise<Response>;

export declare class ApiLegError extends Error {
  readonly kind: "unconfigured" | "unreachable" | "malformed";
  constructor(message: string, kind: "unconfigured" | "unreachable" | "malformed");
}

export interface ApiLeg {
  /** The env name of the service binding to the site's Worker. */
  binding: string;
  /** The env name of the bearer this Worker presents. */
  token: string;
  /** The API's name as an error message opens with it ("The operator API"). */
  api: string;
  userAgent: string;
  /** Further env names that must be set, such as the acting admin's id. */
  require?: string[];
}

/** One request over the API leg to SITE_ORIGIN + path. Throws ApiLegError; an API refusal is a non-ok answer. */
export function callApi(
  env: object,
  leg: ApiLeg,
  path: string,
  init?: { method?: string; headers?: Record<string, string>; json?: unknown; anonymous?: boolean },
): Promise<{ status: number; ok: boolean; body: unknown }>;

export const MCP_PER_MINUTE: 30;
/** One request by `identity`; `perMinute` may only lower the ceiling. Fails closed. */
export function checkRateLimit(namespace: unknown, identity: string, perMinute?: number): Promise<{ allowed: boolean; retryAfter: number }>;
/** A plain-text refusal, never cached or indexed. */
export function refuse(body: string, status: number, headers?: Record<string, string>): Response;

export function mcpScopes<P extends string>(prefix: P): { read: `${P}.read`; write: `${P}.write`; all: [`${P}.read`, `${P}.write`] };

export type McpCaller =
  | { kind: "admin"; props: { email: string } & Record<string, unknown>; scopes: readonly string[] }
  | { kind: "agent"; principal: string; scopes: readonly string[] };

/** The audit name of a caller, never a credential. */
export function callerName(caller: McpCaller): string;
/** Null when the call may proceed, else the refusal to show the caller. */
export function authorizeCall(
  env: { ADMIN_EMAIL?: string },
  caller: McpCaller | undefined,
  scope: string,
  server: { site: string; scopes: { read: string; write: string } },
): string | null;
