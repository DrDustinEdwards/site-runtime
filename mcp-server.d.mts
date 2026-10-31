/** The admin MCP servers' shared scaffold: era router, API leg, door headers, door checks, tool scope and step-up, the tool-call wrapper and cache hints (mcp-server.mjs). */
import type { AuditEnv } from "./audit-log.d.mts";
import type { SiteEntry } from "./sites.mjs";

/**
 * The door's fetch handler: every response (404s and the OAuth library's redirects included) with the entry's full set,
 * X-Robots-Tag noindex, Cache-Control no-store, the consent page's policy on HTML (its style by hash, no form-action)
 * and a load-nothing policy on everything else, both reporting to `reportPath` (default /csp-report) through
 * Reporting-Endpoints. It answers GET /.well-known/security.txt and the report sink itself; a 101 passes as it is.
 */
export function withMcpHeaders<Env>(
  handler: (request: Request, env: Env, ctx: unknown) => Response | Promise<Response>,
  options: {
    site: SiteEntry;
    securityTxt: { contact: string; expires: Date | string; policy?: string };
    reportPath?: string;
    allowReport?: (request: Request, env: Env) => boolean | Promise<boolean>;
  },
): (request: Request, env: Env, ctx: unknown) => Promise<Response>;

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
  /** The HTTP status when an answer came back but was not JSON (kind "malformed"). */
  readonly status?: number;
  constructor(message: string, kind: "unconfigured" | "unreachable" | "malformed", status?: number);
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

/** A 401 Bearer challenge with `resource_metadata` (from `resource`) and `scope`, for a door the provider does not guard. */
export function unauthorized(challenge: { resource: string; scope: readonly string[]; error?: string; description?: string }): Response;
/** Null when the provider's `ctx.auth.audience` is `resource`, else a 401 `invalid_token` challenge. */
export function audienceRefusal(auth: { audience?: unknown } | undefined, resource: string, scope: readonly string[]): Response | null;
/** Null when the Origin is missing, the endpoint's own or listed in `allowed` (exact origins); else the 403. */
export function mcpOriginRefusal(request: Request, allowed?: readonly string[], headers?: Record<string, string>): Response | null;

export function mcpScopes<P extends string>(prefix: P): { read: `${P}.read`; write: `${P}.write`; all: [`${P}.read`, `${P}.write`] };

export type McpCaller =
  | { kind: "admin"; props: { email: string } & Record<string, unknown>; scopes: readonly string[] }
  | { kind: "agent"; principal: string; scopes: readonly string[] }
  /** Someone the server's own door verified (a server with several people); only the grant's scopes are checked. */
  | { kind: "person"; email: string; clientId?: string; scopes: readonly string[] };

/** One server, as refusals, the step-up challenge and the log name it. */
export interface McpServerInfo {
  /** The site refusals name ("dustinedwards.info"). */
  site: string;
  scopes: { read: string; write: string };
  /** serverInfo's name and version, for the log. */
  name: string;
  version: string;
}

/** The scope a tool declares: the level, the server's scope string, or a function of the arguments. Never an annotation. */
export type ToolScopeDeclaration<S extends string = string> = "read" | "write" | S | ((args: Record<string, unknown>) => "read" | "write" | S);

/** The audit name of a caller, never a credential. */
export function callerName(caller: McpCaller): string;
/** The scope a call to `tool` needs, or null when it declares none. */
export function toolScope(tool: { scope?: unknown }, args: Record<string, unknown>, scopes: { read: string; write: string }): string | null;
/** The tools a grant holding `held` can call; a tool with no scope is dropped. Pair with a private `tools/list` hint. */
export function toolsForGrant<T extends { scope?: unknown }>(tools: readonly T[], held: readonly string[], scopes: { read: string; write: string }): T[];
/** Null when the call may proceed, else the refusal to show the caller. A null or unknown scope is refused. */
export function authorizeCall(
  env: { ADMIN_EMAIL?: string },
  caller: McpCaller | undefined,
  scope: string | null | undefined,
  server: { site: string; scopes: { read: string; write: string } },
): string | null;
/** The SDK's per-tool `scopeChallenge`: a 403 step-up naming every scope the call needs, logged as `scope-challenge`. */
export function toolScopeChallenge(
  env: Partial<AuditEnv>,
  server: McpServerInfo,
  tool: { name: string; scope?: unknown },
): (context: {
  request: { params?: Record<string, unknown> };
  authInfo?: { scopes: string[]; clientId?: string; extra?: Record<string, unknown> };
}) => Promise<{ scopes: [string, ...string[]]; errorDescription: string } | undefined>;

export type ToolText = { isError?: boolean; content: Array<{ type: "text"; text: string }> };
/**
 * One tool call: the scope check, the `refused` or `started` row (refusing when it cannot be written), `run`, the
 * `finished` row. When `run` throws, the `finished` row records it (`isError`) and the error is rethrown.
 */
export function invokeTool<O extends ToolText>(
  env: { ADMIN_EMAIL?: string } & Partial<AuditEnv>,
  server: McpServerInfo,
  call: {
    caller: McpCaller | undefined;
    tool: { name: string; scope?: unknown };
    args: Record<string, unknown>;
    /** The request's `_meta` (`ctx.mcpReq._meta`); its traceparent is the rows' correlation id. */
    meta?: Record<string, unknown>;
    run: () => Promise<O>;
  },
): Promise<O | { isError: true; content: Array<{ type: "text"; text: string }> }>;

export type CacheableMethod = "tools/list" | "prompts/list" | "resources/list" | "resources/templates/list" | "resources/read" | "server/discover";
/** The SDK's `cacheHints` option: every cacheable result `ttlMs` (default 60000), private unless named in `shared`. */
export function mcpCacheHints(options?: { ttlMs?: number; shared?: readonly CacheableMethod[] }): Record<CacheableMethod, { ttlMs: number; cacheScope: "public" | "private" }>;
