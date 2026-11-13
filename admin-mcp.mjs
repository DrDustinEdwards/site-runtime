/**
 * The admin MCP Worker: the whole door every site's admin MCP server had copied (Dustin Edwards Admin, Foxing Admin,
 * Foxhound Admin). A server passes what is its own (its name, its consent paragraphs, its registry
 * entry, who is let in, the binding to its site and the MCP server that serves a verified caller) and gets back the
 * Worker's `fetch` and `scheduled`.
 *
 * Request routing, outermost first:
 *
 *   every request          withRequestLog's `request` line, then withMcpHeaders (the set, security.txt, the report sink);
 *                          a throw is a logged 500 that still carries the set
 *   PUBLIC_ORIGIN unset    503 on every route: tokens are bound to PUBLIC_ORIGIN + /mcp, so none could be checked
 *   `routes`               the server's own routes, before anything else (dustinedwards-info's /probe)
 *   /mcp                   a foreign Origin (403), a Host that is not PUBLIC_ORIGIN's (403), the list-only test key,
 *                          an agent key where `agentKeys` is on, then the provider checks the token and the API handler
 *                          checks its audience, admits the person again, rate limits and hands over to `serve`
 *   /authorize /callback   the consent page and the Access sign-in (./mcp-login), /owner the owner page, /health the
 *                          checks below
 *   /register              the registration limit (./mcp-login), then the provider, which allows only exact callbacks
 *   /token /.well-known/*  the provider
 *   /api/operator          the server's own jobs (./operator's door, behind the operator bearer): `run_job`, so Capsid
 *                          Admin runs the tool-call log's copy now through the code the cron runs (./cron runJobTool)
 *
 * Least scope first: the scopes are the provider's (`ctx.auth.scope`, what the consent page granted); a grant with none
 * is refused, never read as read-only. The site's API owns every rule; this door decides only who is talking.
 */

import { agentPrincipal, agentScopes } from "./agent-keys.mjs";
import { auditLogCheck, exportAuditLog, recordAudit } from "./audit-log.mjs";
import { runJobTool, runJobs } from "./cron.mjs";
import { durableObjectCheck, healthResponse, kvCheck, r2Check } from "./health.mjs";
import { deployedSha } from "./deploy.mjs";
import { errorMessage, logEvent, withRequestLog } from "./log.mjs";
import { operatorResponse } from "./operator.mjs";
import {
  DCR_CALLBACKS,
  isAdminUser,
  loginHandler,
  registrationLimited,
  registrationRefusal,
} from "./mcp-login.mjs";
import {
  audienceRefusal,
  callerName,
  checkRateLimit,
  MCP_PER_MINUTE,
  mcpOriginRefusal,
  probeDoor,
  refuse,
  withMcpHeaders,
} from "./mcp-server.mjs";

/** The admin server's own operator door: `run_job` over ADMIN_MCP_JOBS, behind the operator bearer. */
export const ADMIN_MCP_OPERATOR_ROUTE = "/api/operator";

/**
 * The admin server's scheduled jobs: the daily copy of the tool-call log to R2 and the 90-day prune (L6-L7). A failed
 * write throws, so the run shows failed, and /health's log check alerts once rows go uncopied for two days. Its result
 * is exportAuditLog's ({ exported, objects, pruned, verified }), so a run now shows whether the copy's chain verified.
 * @param {import("./admin-mcp.d.mts").AdminMcpEnv} env
 * @returns {import("./cron.d.mts").CronJob[]}
 */
export function adminMcpJobs(env) {
  return [
    {
      name: "tool-call-log-export",
      everyMinutes: 1440,
      timeoutMs: 10 * 60_000,
      run: async () => {
        if (!env.AUDIT_BUCKET)
          throw new Error("AUDIT_BUCKET is not bound; the tool-call log is not copied");
        const done = await exportAuditLog(env, env.AUDIT_BUCKET);
        logEvent("tool_call_log_exported", { exported: done.exported, pruned: done.pruned });
        return done;
      },
    },
  ];
}

/** The one MCP route on every admin server. */
export const ADMIN_MCP_ROUTE = "/mcp";

/**
 * Origins that may call /mcp besides the server's own: claude.ai, as on Capsid. A missing Origin passes too (MCP clients
 * are not browsers); any other page is refused before the token is read (DNS rebinding).
 */
export const ADMIN_MCP_ORIGINS = /* @__PURE__ */ Object.freeze(["https://claude.ai"]);

/**
 * The configured origin without a trailing slash, or "" when unset. There is no default: an unset origin serves nothing.
 * @param {{ PUBLIC_ORIGIN?: string }} env
 */
export function adminMcpOrigin(env) {
  return (env.PUBLIC_ORIGIN?.trim() ?? "").replace(/\/+$/, "");
}

/**
 * @template {import("./admin-mcp.d.mts").AdminMcpEnv} E
 * @param {import("./admin-mcp.d.mts").AdminMcpOptions<E>} options
 */
export function adminMcpWorker({
  name,
  server,
  site,
  securityTxt,
  about,
  serve,
  OAuthProvider,
  api,
  admit = isAdminUser,
  agentKeys = false,
  routes,
  checks,
  operatorToken = "OPERATOR_TOKEN",
}) {
  const scopes = server.scopes;
  const all = [scopes.read, scopes.write];
  const auditServer = { name: server.name, version: server.version };

  /** @param {E} env @param {import("./mcp-server.d.mts").McpCaller} caller @param {number} retryAfter @param {string} [clientId] */
  async function rateLimited(env, caller, retryAfter, clientId) {
    // A burst is a row in the tool-call log beside the calls and sign-ins (checklist L2), naming the caller, never a credential.
    await recordAudit(env, {
      callId: crypto.randomUUID(),
      phase: "rate-limited",
      caller: callerName(caller),
      server: auditServer,
      ...(clientId ? { clientId } : {}),
    });
    return refuse(
      `Rate limited. ${name} allows ${MCP_PER_MINUTE} requests per 60 seconds. ${server.site}'s API applies its own limit as well.`,
      429,
      {
        "retry-after": String(retryAfter),
      },
    );
  }

  /**
   * The authenticated surface. The provider has validated the token; the audience and the person are checked AGAIN here,
   * because a grant is long lived and this is the boundary a request actually crosses.
   */
  const apiHandler = {
    /** @param {Request} request @param {E} env @param {ExecutionContext} ctx */
    async fetch(request, env, ctx) {
      const { props, auth } =
        /** @type {ExecutionContext & { props?: Record<string, unknown>, auth?: import("./admin-mcp.d.mts").AdminMcpAuth }} */ (
          ctx
        );
      // RFC 8707, rule 12.2: a token not issued for this server is refused, even if a provider set up for another resource handed one over.
      const wrongAudience = audienceRefusal(auth, `${adminMcpOrigin(env)}${ADMIN_MCP_ROUTE}`, [
        scopes.read,
      ]);
      if (wrongAudience) return wrongAudience;
      const email = typeof props?.email === "string" ? props.email : "";
      if (!email || !(await admit(env, { ...props, email }))) {
        logEvent("door_refused", { reason: "not-admitted" }, { level: "warn" });
        return refuse(`Forbidden. This grant does not belong to an administrator of ${name}.`, 403);
      }
      // A grant with no scope list is refused, not read as read-only (Grok audit 2026-10-21, FX-16).
      if (!Array.isArray(auth?.scope))
        return refuse("This grant carries no scope. Sign in again.", 403);
      /** @type {import("./admin-mcp.d.mts").AdminMcpCaller} */
      const caller = { kind: "admin", props: { ...props, email }, scopes: auth.scope, auth };
      // Keyed by the verified email, the thing worth limiting. Fails closed when the binding is missing.
      const limit = await checkRateLimit(env.MCP_RATE_LIMIT, `admin:${email.toLowerCase()}`);
      if (!limit.allowed) return rateLimited(env, caller, limit.retryAfter, auth.clientId);
      return serve(request, env, ctx, caller);
    },
  };

  /** One check per binding the door needs, then the server's own, then the tool-call log's (L8). */
  /** @param {E} env @returns {import("./health.d.mts").HealthCheck[]} */
  function healthChecks(env) {
    /** @param {string} check @param {unknown} binding @param {(b: any) => import("./health.d.mts").HealthCheck} make */
    const bound = (check, binding, make) =>
      binding
        ? make(binding)
        : { name: check, run: async () => ({ ok: false, detail: "binding missing" }) };
    const siteBinding =
      /** @type {{ fetch?: (request: Request) => Promise<Response> } | undefined} */ (
        /** @type {Record<string, unknown>} */ (env)[api.binding]
      );
    /** @type {import("./health.d.mts").HealthCheck[]} */
    const list = [
      // Fail: without OAUTH_KV no token is checked, without the site binding no tool reaches the API, without the limiter
      // every /mcp call is a 429 (it fails closed) and without the log every tool call is refused. The site binding is
      // checked by presence: a request over it would be an API call. The Durable Object checks mint an id and wake nothing.
      { ...bound("oauth-kv", env.OAUTH_KV, (b) => kvCheck("oauth-kv", b)), level: "fail" },
      {
        name: api.name,
        level: "fail",
        run: async () =>
          typeof siteBinding?.fetch === "function" || { ok: false, detail: "binding missing" },
      },
      {
        ...durableObjectCheck(
          "mcp-rate-limit",
          /** @type {{ idFromName(name: string): unknown } | undefined} */ (env.MCP_RATE_LIMIT),
        ),
        level: "fail",
      },
      {
        ...durableObjectCheck(
          "tool-call-log-binding",
          /** @type {{ idFromName(name: string): unknown } | undefined} */ (env.TOOL_CALL_LOG),
        ),
        level: "fail",
      },
      // The log's copies only, so a bucket that fails to answer warns. One `head` of a fixed key, never a list.
      {
        ...bound("audit-bucket", env.AUDIT_BUCKET, (b) => r2Check("audit-bucket", b)),
        level: "warn",
      },
    ];
    // Every server: a real request over the binding, so a site that is down shows here, not only a binding that is
    // missing. `.invalid` (RFC 6761) names no real host: the site answers it without its API (a redirect to its canonical
    // host or its 404). Warn: the site is another Worker, and rolling this one back would not mend it.
    if (typeof siteBinding?.fetch === "function") {
      const fetcher = siteBinding.fetch.bind(siteBinding);
      list.push({
        name: `${api.name}-reach`,
        level: "warn",
        run: async () => {
          const answer = await fetcher(
            new Request(`https://${api.name}.invalid/`, { redirect: "manual" }),
          );
          await answer.body?.cancel();
          return (
            answer.status < 500 || { ok: false, detail: `${api.name} answered ${answer.status}` }
          );
        },
      });
    }
    return [...list, ...(checks ? checks(env) : []), auditLogCheck(env)];
  }

  const defaultHandler = loginHandler({
    name,
    scopes,
    about,
    admit: (env, user) => admit(/** @type {E} */ (/** @type {unknown} */ (env)), user),
    // Every sign-in, admitted or refused, is a row in the tool-call log.
    audit: auditServer,
    // CI's deploy (devkit's worker-deploy.yml) passes DEPLOY_SHA and waits for /health to report it.
    health: (env) =>
      healthResponse({
        sha: deployedSha(env),
        checks: healthChecks(/** @type {E} */ (/** @type {unknown} */ (env))),
      }),
  });

  /** @type {Map<string, { fetch(request: Request, env: E, ctx: ExecutionContext): Promise<Response> }>} */
  const providers = new Map();

  /**
   * One provider per origin and registration allowlist: both are fixed at construction, so a changed allowlist gets a
   * new provider, never a stale one.
   * @param {E} env
   */
  function providerFor(env) {
    const origin = adminMcpOrigin(env);
    const allowed = [...DCR_CALLBACKS, env.DCR_REDIRECT_URIS ?? ""].join(",");
    const key = `${origin} ${allowed}`;
    let provider = providers.get(key);
    if (!provider) {
      provider = new OAuthProvider({
        apiRoute: ADMIN_MCP_ROUTE,
        apiHandler,
        // The provider adds OAUTH_PROVIDER to env before the login handler runs, which its types do not say.
        defaultHandler: /** @type {ExportedHandler<E>} */ (/** @type {unknown} */ (defaultHandler)),
        authorizeEndpoint: "/authorize",
        tokenEndpoint: "/token",
        // AUDIENCE BINDING (rule 12.2, RFC 8707): every grant and token is pinned to exactly this server's /mcp. Nothing is
        // passed through: the API leg uses the server's own bearer, never the client's token.
        resourceMetadata: {
          resource: `${origin}${ADMIN_MCP_ROUTE}`,
          authorization_servers: [origin],
          resource_name: name,
        },
        // Every scope in the protected resource metadata and the 401's challenge (checklist A1, RFC 9728); least scope
        // first is still decided at consent (the write box) and per tool (the 403 step-up).
        requiredScopes: all,
        scopesSupported: all,
        // Rule 13. CIMD for Claude, Claude Code and ChatGPT, which send their client_id as a metadata URL and never
        // register (needs the global_fetch_strictly_public flag). Tightened DCR beside it for Grok and Gemini: exact
        // callbacks only, rate limited before the provider sees it, and a registration grants nothing. Remove DCR when
        // they support CIMD, at the latest when the specification removes it.
        clientIdMetadataDocumentEnabled: true,
        clientRegistrationEndpoint: "/register",
        clientRegistrationCallback: (
          /** @type {{ clientMetadata: Record<string, unknown> }} */ { clientMetadata },
        ) => {
          const why = registrationRefusal(allowed, clientMetadata);
          if (!why) return undefined;
          logEvent("registration_refused", { why }, { level: "warn" });
          return { code: "invalid_redirect_uri", description: why };
        },
      });
      providers.set(key, /** @type {any} */ (provider));
    }
    return /** @type {{ fetch(request: Request, env: E, ctx: ExecutionContext): Promise<Response> }} */ (
      provider
    );
  }

  /** @param {Request} request @param {E} env @param {ExecutionContext} ctx @returns {Promise<Response>} */
  async function route(request, env, ctx) {
    const origin = adminMcpOrigin(env);
    if (!origin)
      return refuse(
        `${name} is not configured: PUBLIC_ORIGIN is unset. Not configured means not open.`,
        503,
      );
    const own = routes ? await routes(request, env, ctx) : null;
    if (own) return own;
    const url = new URL(request.url);
    if (url.pathname === ADMIN_MCP_OPERATOR_ROUTE) {
      const token = /** @type {Record<string, unknown>} */ (env)[operatorToken];
      return operatorResponse(request, {
        token: typeof token === "string" ? token : undefined,
        limiter: /** @type {import("./operator.d.mts").OperatorOptions["limiter"]} */ (
          env.MCP_RATE_LIMIT
        ),
        tools: { run_job: runJobTool(null, adminMcpJobs(env)) },
      });
    }
    if (url.pathname === ADMIN_MCP_ROUTE) {
      // Before the token is read, so a page on another origin learns nothing from a 401 (DNS rebinding).
      const foreign = mcpOriginRefusal(request, ADMIN_MCP_ORIGINS);
      if (foreign) return foreign;
      // A rebound name pointing here is refused too (area 11, P10). On Workers the URL's host is the Host the client sent.
      if (url.hostname !== new URL(origin).hostname)
        return refuse("Forbidden. This is not a host this server answers on.", 403);
      // THE LIST-ONLY TEST KEY (Dustin 2026-11-01): MCP_PROBE_KEY lets the daily live check connect and list tools, and
      // nothing else. Before the provider, which answers 401 to any token it did not mint. No key, or none set, is null.
      const probed = await probeDoor(request, env, {
        server,
        limiter: env.MCP_RATE_LIMIT,
        serve: (req, caller) => serve(req, env, ctx, caller),
      });
      if (probed) return probed;
      if (agentKeys) {
        // Ruling 37: an agent that cannot finish OAuth has a named key (./agent-keys). Tried, never required: no
        // AGENT_KEY_* secret, or a key matching none, is null and goes on to the provider. The principal comes from the
        // secret's name, never the request, and has its own limit, so an agent cannot rate limit the owner out.
        const principal = await agentPrincipal(
          /** @type {Record<string, unknown>} */ (env),
          request.headers.get("authorization"),
        );
        if (principal) {
          logEvent("agent_key_accepted", { principal, method: request.method });
          const caller = /** @type {const} */ ({
            kind: "agent",
            principal,
            scopes: agentScopes(env, principal, scopes),
          });
          const limit = await checkRateLimit(env.MCP_RATE_LIMIT, `agent:${principal}`);
          if (!limit.allowed) return rateLimited(env, caller, limit.retryAfter);
          return serve(request, env, ctx, caller);
        }
      }
    }
    if (url.pathname === "/register" && request.method === "POST") {
      const limited = await registrationLimited(request, env.OAUTH_KV);
      if (limited) return limited;
    }
    return providerFor(env).fetch(request, env, ctx);
  }

  const door = withMcpHeaders(
    /** @param {Request} request @param {E} env @param {unknown} ctx */
    async (request, env, ctx) => {
      try {
        return await route(request, env, /** @type {ExecutionContext} */ (ctx));
      } catch (error) {
        logEvent("unhandled_error", { detail: errorMessage(error) }, { level: "error" });
        return refuse("Internal error. The request was not completed.", 500);
      }
    },
    {
      site,
      securityTxt,
      allowReport: async (request, env) =>
        (
          await checkRateLimit(
            env.MCP_RATE_LIMIT,
            `csp-report:${request.headers.get("CF-Connecting-IP") ?? "unknown"}`,
          )
        ).allowed,
    },
  );

  return {
    // One `request` line per request (./log: path, status, ms and the deployed commit; never a query).
    fetch: withRequestLog(
      /** @param {Request} request @param {E} env @param {ExecutionContext} ctx */ (
        request,
        env,
        ctx,
      ) => door(request, env, ctx),
      { sha: (env) => deployedSha(env) },
    ),
    /**
     * The server's jobs (adminMcpJobs), through ./cron's runJobs as on every site: isolated, timed out, logged, and a
     * failure fails the invocation. The admin server has no D1, so nothing goes to cron_runs; /health's log check is
     * what notices a copy that stopped.
     * @param {unknown} _controller @param {E} env
     */
    async scheduled(_controller, env) {
      await runJobs(null, adminMcpJobs(env));
    },
  };
}
