/**
 * The admin server's scheduled jobs: the daily copy of the tool-call log to R2 and the 90-day prune (L6-L7). A failed
 * write throws, so the run shows failed, and /health's log check alerts once rows go uncopied for two days. Its result
 * is exportAuditLog's ({ exported, objects, pruned, verified }), so a run now shows whether the copy's chain verified.
 * @param {AdminMcpEnv} env
 * @returns {import("./cron.mjs").CronJob[]}
 */
export function adminMcpJobs(env: AdminMcpEnv): import("./cron.mjs").CronJob[];
/**
 * The configured origin without a trailing slash, or "" when unset. There is no default: an unset origin serves nothing.
 * @param {{ PUBLIC_ORIGIN?: string }} env
 */
export function adminMcpOrigin(env: {
    PUBLIC_ORIGIN?: string;
}): string;
/**
 * @template {AdminMcpEnv} E
 * @param {AdminMcpOptions<E>} options
 */
export function adminMcpWorker<E extends AdminMcpEnv>({ name, server, site, securityTxt, about, serve, OAuthProvider, api, admit, agentKeys, routes, checks, operatorToken, }: AdminMcpOptions<E>): {
    fetch: (request: Request, env: E, ctx: ExecutionContext<any>) => Promise<Response>;
    /**
     * The server's jobs (adminMcpJobs), through ./cron's runJobs as on every site: isolated, timed out, logged, and a
     * failure fails the invocation. The admin server has no D1, so nothing goes to cron_runs; /health's log check is
     * what notices a copy that stopped.
     * @param {unknown} _controller @param {E} env
     */
    scheduled(_controller: unknown, env: E): Promise<void>;
};
/** @import { OAuthProviderOptions } from "@cloudflare/workers-oauth-provider" */
/** @import { AuditEnv } from "./audit-log.mjs" */
/** @import { HealthCheck } from "./health.mjs" */
/** @import { LoginEnv } from "./mcp-login.mjs" */
/** @import { McpServerInfo } from "./mcp-server.mjs" */
/** @import { ServedSiteEntry } from "./sites.mjs" */
/**
 * What the door reads from the Worker's env, besides the site binding the server names in `api.binding`.
 *
 * - `OAUTH_KV`: Grants and tokens for workers-oauth-provider, and the owner page's sessions.
 * - `MCP_RATE_LIMIT`: The door's limiter (./rate-limit/durable-object's RateLimiter). Fails closed: without it every /mcp call is a 429.
 * - `AUDIT_BUCKET`: The tool-call log's copies in R2, written by `scheduled`.
 * - `PUBLIC_ORIGIN`: The one public origin; every token is bound to its /mcp (RFC 8707). Unset serves nothing.
 * - `DCR_REDIRECT_URIS`: Exact redirect URIs a dynamically registered client may use beside DCR_CALLBACKS, comma or space separated.
 * - `ADMIN_EMAIL`: The main administrator; `isAdminUser` admits it.
 * - `CO_OWNER_EMAILS`: Co-owners, comma-separated: admitted like ADMIN_EMAIL, with no say over who is admin.
 * - `MCP_PROBE_KEY`: The list-only test key (./mcp-server probeDoor): lists tools, runs none.
 * - `AGENT_WRITE`: Agent principals that hold the write scope, where `agentKeys` is on.
 * - `DEPLOY_SHA`: The deployed commit, from CI's deploy, reported by /health and the request log.
 * @typedef {Omit<LoginEnv, "OAUTH_PROVIDER" | "OAUTH_KV"> & Partial<AuditEnv> & { OAUTH_KV: LoginEnv["OAUTH_KV"] & { put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>; }; MCP_RATE_LIMIT?: Parameters<typeof import("./mcp-server.mjs").checkRateLimit>[0]; AUDIT_BUCKET?: R2Bucket; PUBLIC_ORIGIN?: string; DCR_REDIRECT_URIS?: string; ADMIN_EMAIL?: string; CO_OWNER_EMAILS?: string; MCP_PROBE_KEY?: string; AGENT_WRITE?: string; DEPLOY_SHA?: string; }} AdminMcpEnv
 */
/**
 * The provider's `ctx.auth` for a token it minted.
 * @typedef {object} AdminMcpAuth
 * @property {string} token
 * @property {string} audience
 * @property {string[]} scope
 * @property {number} [expiresAt]
 * @property {string} [userId]
 * @property {string} [clientId]
 */
/**
 * Who a request is, as the door established it. Never read from the request.
 * @typedef {| {
 *     kind: "admin";
 *     props: { email: string } & Record<string, unknown>;
 *     scopes: readonly string[];
 *     auth: AdminMcpAuth;
 *   }
 * | { kind: "agent"; principal: string; scopes: readonly string[] }
 * | { kind: "probe"; principal: string; scopes: readonly string[] }} AdminMcpCaller
 */
/**
 * @template {AdminMcpEnv} E
 *
 * - `name`: The server's name ("Sample Admin"): the consent page, the protected resource metadata and every refusal.
 * - `server`: The server as refusals, the step-up and the log name it, with its scopes (./mcp-server mcpScopes).
 * - `site`: The door's registry entry (./sites), for withMcpHeaders.
 * - `securityTxt`: The security.txt contact and expiry, as the site itself sends them.
 * - `about`: The server's own paragraphs on the consent page (trusted HTML).
 * - `serve`: Serves one request whose caller the door has established: the server's MCP handler.
 * - `OAuthProvider`: The provider class, `@cloudflare/workers-oauth-provider`'s default export (1.2.4 or later), from the server's own dependency.
 * - `api`: The service binding to the site: its env name (`binding`) and the name of its /health checks (`name`, and `<name>-reach`, the warn-level request that shows the site is up).
 * - `admit`: Who is let in, at sign-in and again on every request. Default: isAdminUser (ADMIN_EMAIL or CO_OWNER_EMAILS).
 * - `agentKeys`: Named agent keys on /mcp (./agent-keys). Default false: an admin server lets in only its administrator and the test key.
 * - `routes`: The server's own routes, tried first: a Response answers, null goes on.
 * - `checks`: More /health checks, for the server's own bindings.
 * - `operatorToken`: The env name of the bearer /api/operator (`run_job`) takes: default "OPERATOR_TOKEN", the secret the server already sends to its site, so Capsid holds one token per site. Unset or short closes the route (503).
 * @typedef {{ name: string; server: McpServerInfo; site: ServedSiteEntry; securityTxt: { contact: string; expires: Date | string; policy?: string }; about: string; serve(request: Request, env: E, ctx: ExecutionContext, caller: AdminMcpCaller): Promise<Response>; OAuthProvider: new (options: OAuthProviderOptions<E>) => { fetch(request: Request, env: E, ctx: ExecutionContext): Promise<Response>; }; api: { binding: string; name: string }; admit?( env: E, user: { email: string } & Record<string, unknown>, ): boolean | Record<string, unknown> | null | Promise<boolean | Record<string, unknown> | null>; agentKeys?: boolean; routes?( request: Request, env: E, ctx: ExecutionContext, ): Response | null | Promise<Response | null>; checks?(env: E): HealthCheck[]; operatorToken?: string; }} AdminMcpOptions
 */
/** The admin server's own operator door: `run_job` over ADMIN_MCP_JOBS, behind the operator bearer. */
export const ADMIN_MCP_OPERATOR_ROUTE: "/api/operator";
/** The one MCP route on every admin server. */
export const ADMIN_MCP_ROUTE: "/mcp";
/**
 * Origins that may call /mcp besides the server's own: claude.ai, as on Capsid. A missing Origin passes too (MCP clients
 * are not browsers); any other page is refused before the token is read (DNS rebinding).
 */
export const ADMIN_MCP_ORIGINS: readonly string[];
/**
 * What the door reads from the Worker's env, besides the site binding the server names in `api.binding`.
 *
 * - `OAUTH_KV`: Grants and tokens for workers-oauth-provider, and the owner page's sessions.
 * - `MCP_RATE_LIMIT`: The door's limiter (./rate-limit/durable-object's RateLimiter). Fails closed: without it every /mcp call is a 429.
 * - `AUDIT_BUCKET`: The tool-call log's copies in R2, written by `scheduled`.
 * - `PUBLIC_ORIGIN`: The one public origin; every token is bound to its /mcp (RFC 8707). Unset serves nothing.
 * - `DCR_REDIRECT_URIS`: Exact redirect URIs a dynamically registered client may use beside DCR_CALLBACKS, comma or space separated.
 * - `ADMIN_EMAIL`: The main administrator; `isAdminUser` admits it.
 * - `CO_OWNER_EMAILS`: Co-owners, comma-separated: admitted like ADMIN_EMAIL, with no say over who is admin.
 * - `MCP_PROBE_KEY`: The list-only test key (./mcp-server probeDoor): lists tools, runs none.
 * - `AGENT_WRITE`: Agent principals that hold the write scope, where `agentKeys` is on.
 * - `DEPLOY_SHA`: The deployed commit, from CI's deploy, reported by /health and the request log.
 */
export type AdminMcpEnv = Omit<LoginEnv, "OAUTH_PROVIDER" | "OAUTH_KV"> & Partial<AuditEnv> & {
    OAUTH_KV: LoginEnv["OAUTH_KV"] & {
        put(key: string, value: string, options?: {
            expirationTtl?: number;
        }): Promise<void>;
    };
    MCP_RATE_LIMIT?: Parameters<typeof import("./mcp-server.mjs").checkRateLimit>[0];
    AUDIT_BUCKET?: R2Bucket;
    PUBLIC_ORIGIN?: string;
    DCR_REDIRECT_URIS?: string;
    ADMIN_EMAIL?: string;
    CO_OWNER_EMAILS?: string;
    MCP_PROBE_KEY?: string;
    AGENT_WRITE?: string;
    DEPLOY_SHA?: string;
};
/**
 * The provider's `ctx.auth` for a token it minted.
 */
export type AdminMcpAuth = {
    token: string;
    audience: string;
    scope: string[];
    expiresAt?: number | undefined;
    userId?: string | undefined;
    clientId?: string | undefined;
};
/**
 * Who a request is, as the door established it. Never read from the request.
 */
export type AdminMcpCaller = {
    kind: "admin";
    props: {
        email: string;
    } & Record<string, unknown>;
    scopes: readonly string[];
    auth: AdminMcpAuth;
} | {
    kind: "agent";
    principal: string;
    scopes: readonly string[];
} | {
    kind: "probe";
    principal: string;
    scopes: readonly string[];
};
export type AdminMcpOptions<E extends AdminMcpEnv> = {
    name: string;
    server: McpServerInfo;
    site: ServedSiteEntry;
    securityTxt: {
        contact: string;
        expires: Date | string;
        policy?: string;
    };
    about: string;
    serve(request: Request, env: E, ctx: ExecutionContext, caller: AdminMcpCaller): Promise<Response>;
    OAuthProvider: new (options: OAuthProviderOptions<E>) => {
        fetch(request: Request, env: E, ctx: ExecutionContext): Promise<Response>;
    };
    api: {
        binding: string;
        name: string;
    };
    admit?(env: E, user: {
        email: string;
    } & Record<string, unknown>): boolean | Record<string, unknown> | null | Promise<boolean | Record<string, unknown> | null>;
    agentKeys?: boolean;
    routes?(request: Request, env: E, ctx: ExecutionContext): Response | null | Promise<Response | null>;
    checks?(env: E): HealthCheck[];
    operatorToken?: string;
};
import type { LoginEnv } from "./mcp-login.mjs";
import type { AuditEnv } from "./audit-log.mjs";
import type { McpServerInfo } from "./mcp-server.mjs";
import type { ServedSiteEntry } from "./sites.mjs";
import type { OAuthProviderOptions } from "@cloudflare/workers-oauth-provider";
import type { HealthCheck } from "./health.mjs";
