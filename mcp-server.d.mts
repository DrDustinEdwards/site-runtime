/**
 * The admin MCP servers' shared scaffold: era router, API leg, door headers, door checks, tool scope and step-up, the
 * tool-call wrapper and its registration, outside text in a result, the tool list's rules and pin, and cache hints
 * (mcp-server.mjs).
 */
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
  /** `canceled`: the call's signal aborted, so the request was not sent or was cut off. */
  readonly kind: "unconfigured" | "unreachable" | "canceled" | "malformed";
  /** The HTTP status when an answer came back but was not JSON (kind "malformed"). */
  readonly status?: number;
  constructor(message: string, kind: "unconfigured" | "unreachable" | "canceled" | "malformed", status?: number);
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

/**
 * One request over the API leg to SITE_ORIGIN + path. Throws ApiLegError (`canceled` when `signal`, the tool call's,
 * aborts); an API refusal is a non-ok answer.
 */
export function callApi(
  env: object,
  leg: ApiLeg,
  path: string,
  init?: { method?: string; headers?: Record<string, string>; json?: unknown; anonymous?: boolean; signal?: AbortSignal },
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
  | { kind: "person"; email: string; clientId?: string; scopes: readonly string[] }
  /** The list-only test key (./agent-keys `probeCaller`): listed what a read grant is, refused every call. */
  | { kind: "probe"; principal: string; scopes: readonly string[] };

/** One server, as refusals, the step-up challenge and the log name it. */
export interface McpServerInfo {
  /** The site refusals name ("example.com"). */
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
 * `finished` row. When `run` throws, the `finished` row records it (`isError`) and the error is rethrown. With `signal`
 * (`ctx.mcpReq.signal`) aborted before the run, nothing runs; `run` gets the signal to pass on, and a call the client
 * left is logged `canceled`.
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
    /** The request's abort signal (`ctx.mcpReq.signal`). */
    signal?: AbortSignal;
    run: (signal?: AbortSignal) => Promise<O>;
  },
): Promise<O | { isError: true; content: Array<{ type: "text"; text: string }> }>;

/** An MCP icon (`tools/list`, `serverInfo`): an https URL or a `data:image/` URI. */
export type McpIcon = { src: string; mimeType?: string; sizes?: string[]; theme?: "light" | "dark" };

/**
 * Registers the tools the caller's grant can call (`toolsForGrant`), in order, each with `icons` unless it has its own,
 * the step-up challenge, and `invokeTool` with the request's `_meta` and abort signal. `config(tool)` defaults to
 * `tool.config`, `run` to `tool.handler(env, args, signal)`. Returns the tools listed.
 */
export function registerTools<T extends { name: string; scope?: unknown }>(
  mcp: { registerTool: (name: string, config: any, callback: (args: any, ctx: any) => unknown) => unknown },
  tools: readonly T[],
  options: {
    env: { ADMIN_EMAIL?: string } & Partial<AuditEnv>;
    server: McpServerInfo;
    caller: McpCaller | undefined;
    icons?: readonly McpIcon[];
    config?: (tool: T) => Record<string, unknown>;
    run?: (tool: T, args: Record<string, unknown>, signal?: AbortSignal) => Promise<any>;
  },
): T[];

/** The line a result with outside text opens with. */
export const OUTSIDE_DATA_NOTICE: string;
/**
 * A tool result whose text came from outside (S2): the notice, then the value inside `untrusted`'s `<data>` delimiters.
 * An object is also the `structuredContent`, with the notice as its `notice` field.
 */
export function outsideResult(
  label: string,
  value: string | Record<string, unknown>,
): { content: Array<{ type: "text"; text: string }>; structuredContent?: Record<string, unknown> };

/** One finding on a `tools/list` result. */
export type ToolListProblem = { item: "T1" | "T2" | "T3" | "T4" | "T9"; tool: string; severity: "error" | "warning"; detail: string };
/** What is wrong with a `tools/list` result's tools (T1 names and text, T2 hints, T3 outputSchema, T4 inputSchema, T9 icons). */
export function toolListProblems(tools: ReadonlyArray<Record<string, any>>): ToolListProblem[];
/** SHA-256 hex of the tools as `tools/list` sends them, `_meta` left out, sorted by name, canonical JSON (T12). */
export function toolListHash(tools: ReadonlyArray<Record<string, unknown>>): Promise<string>;

export type CacheableMethod = "tools/list" | "prompts/list" | "resources/list" | "resources/templates/list" | "resources/read" | "server/discover";
/** The SDK's `cacheHints` option: every cacheable result `ttlMs` (default 60000), private unless named in `shared`. */
export function mcpCacheHints(options?: { ttlMs?: number; shared?: readonly CacheableMethod[] }): Record<CacheableMethod, { ttlMs: number; cacheScope: "public" | "private" }>;
/** The methods the list-only test key may send: the handshake, ping, the lists, and notifications. */
export const PROBE_METHODS: ReadonlySet<string>;
/** The test key's request to serve (body already read), or a logged 403 JSON-RPC refusal for any other method. */
export function probeRefusal(
  env: Partial<AuditEnv>,
  server: McpServerInfo,
  request: Request,
): Promise<{ request: Request; refusal?: undefined } | { refusal: Response; request?: undefined }>;
