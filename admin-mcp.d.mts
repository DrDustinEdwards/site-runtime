/**
 * The admin MCP Worker: the door, OAuth provider, sign-in, /health and the tool-call log's cron that every site's admin
 * MCP server shares (admin-mcp.mjs).
 */
import type { AuditEnv } from "./audit-log.d.mts";
import type { HealthCheck } from "./health.d.mts";
import type { LoginEnv } from "./mcp-login.d.mts";
import type { McpServerInfo } from "./mcp-server.d.mts";
import type { SiteEntry } from "./sites.mjs";

/** The one MCP route on every admin server. */
export const ADMIN_MCP_ROUTE: "/mcp";
/** Origins that may call /mcp besides the server's own (claude.ai). */
export const ADMIN_MCP_ORIGINS: readonly string[];

/** PUBLIC_ORIGIN without a trailing slash, or "" when unset. */
export function adminMcpOrigin(env: { PUBLIC_ORIGIN?: string }): string;

/** What the door reads from the Worker's env, besides the site binding the server names in `api.binding`. */
export interface AdminMcpEnv extends Omit<LoginEnv, "OAUTH_PROVIDER" | "OAUTH_KV">, Partial<AuditEnv> {
  /** Grants and tokens for workers-oauth-provider, and the owner page's sessions. */
  OAUTH_KV: LoginEnv["OAUTH_KV"] & { put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> };
  /** The door's limiter (./rate-limit/durable-object's RateLimiter). Fails closed: without it every /mcp call is a 429. */
  MCP_RATE_LIMIT?: Parameters<typeof import("./mcp-server.d.mts").checkRateLimit>[0];
  /** The tool-call log's copies in R2, written by `scheduled`. */
  AUDIT_BUCKET?: R2Bucket;
  /** The one public origin; every token is bound to its /mcp (RFC 8707). Unset serves nothing. */
  PUBLIC_ORIGIN?: string;
  /** Exact redirect URIs a dynamically registered client may use beside DCR_CALLBACKS, comma or space separated. */
  DCR_REDIRECT_URIS?: string;
  /** The single administrator `isAdminUser` admits. */
  ADMIN_EMAIL?: string;
  /** The list-only test key (./mcp-server probeDoor): lists tools, runs none. */
  MCP_PROBE_KEY?: string;
  /** Agent principals that hold the write scope, where `agentKeys` is on. */
  AGENT_WRITE?: string;
  /** The deployed commit, from CI's deploy, reported by /health and the request log. */
  DEPLOY_SHA?: string;
}

/** The provider's `ctx.auth` for a token it minted. */
export interface AdminMcpAuth {
  token: string;
  audience: string;
  scope: string[];
  expiresAt?: number;
  userId?: string;
  clientId?: string;
}

/** Who a request is, as the door established it. Never read from the request. */
export type AdminMcpCaller =
  /** A person the provider's token names and `admit` let in again on this request, with the grant's scopes. */
  | { kind: "admin"; props: { email: string } & Record<string, unknown>; scopes: readonly string[]; auth: AdminMcpAuth }
  /** A named agent key (`agentKeys`), read, and write when AGENT_WRITE names it. */
  | { kind: "agent"; principal: string; scopes: readonly string[] }
  /** The list-only test key: listed what a read grant is, refused every call. */
  | { kind: "probe"; principal: string; scopes: readonly string[] };

export interface AdminMcpOptions<E extends AdminMcpEnv> {
  /** The server's name ("Sample Admin"): the consent page, the protected resource metadata and every refusal. */
  name: string;
  /** The server as refusals, the step-up and the log name it, with its scopes (./mcp-server mcpScopes). */
  server: McpServerInfo;
  /** The door's registry entry (./sites), for withMcpHeaders. */
  site: SiteEntry;
  /** The security.txt contact and expiry, as the site itself sends them. */
  securityTxt: { contact: string; expires: Date | string; policy?: string };
  /** The server's own paragraphs on the consent page (trusted HTML). */
  about: string;
  /** Serves one request whose caller the door has established: the server's MCP handler. */
  serve(request: Request, env: E, ctx: ExecutionContext, caller: AdminMcpCaller): Promise<Response>;
  /** The provider class, `@cloudflare/workers-oauth-provider`'s default export (1.2.4 or later), from the server's own dependency. */
  OAuthProvider: new (options: any) => { fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> };
  /**
   * The service binding to the site: its env name (`binding`), the name of its /health check (`name`), and `reach`, a
   * URL the site answers without its API, for a warn-level check that it is up.
   */
  api: { binding: string; name: string; reach?: string };
  /** Who is let in, at sign-in and again on every request. Default: isAdminUser (ADMIN_EMAIL). */
  admit?(env: E, user: { email: string } & Record<string, unknown>): boolean | Record<string, unknown> | null | Promise<boolean | Record<string, unknown> | null>;
  /** Named agent keys on /mcp (./agent-keys). Default false: an admin server lets in only its administrator and the test key. */
  agentKeys?: boolean;
  /** The server's own routes, tried first: a Response answers, null goes on. */
  routes?(request: Request, env: E, ctx: ExecutionContext): Response | null | Promise<Response | null>;
  /** More /health checks, for the server's own bindings. */
  checks?(env: E): HealthCheck[];
}

/** The Worker's default export: the door, and the daily copy of the tool-call log. */
export function adminMcpWorker<E extends AdminMcpEnv>(
  options: AdminMcpOptions<E>,
): {
  fetch(request: Request, env: E, ctx: ExecutionContext): Promise<Response>;
  scheduled(controller: unknown, env: E): Promise<void>;
};
