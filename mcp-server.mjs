// The admin MCP servers' shared scaffold (shared-code sweep round 2, item 4): the era router with its prior-era shim, the
// API leg's transport, the door's checks (rate limit, Origin, token audience), the per-tool scope with its step-up
// challenge, the one wrapper every tool call runs through, and the list cache hints. Each admin MCP (dustinedwards-info,
// foxing) is a wrapper over its site's own API, which owns every rule; nothing here interprets one.
//
// No dependency, like the rest of the package: the MCP SDK and `agents` are the caller's, and the era router is handed
// their two functions.

import { appendAudit, correlationId, loggedArgs, loggedResult, recordAudit } from "./audit-log.mjs";
import { limit } from "./rate-limit/limit.mjs";
import { isAdminUser } from "./mcp-login.mjs";
import { originRefusal, originVerdict } from "./origin.mjs";

// ---------------------------------------------------------------------------------------------------------------------
// THE ERA ROUTER, and the prior-era shim.
//
// MCP 2026-07-28 removed the `initialize` handshake, sessions and the GET stream. The primary handler is built
// `legacy: "reject"`: stateless and modern-only, with no compatibility thinking in it. A legacy client against a
// modern-only server fails with no fall-forward, and the clients these servers serve still open legacy, so prior-era
// traffic is diverted here, in front of it, as the library documents on `isLegacyRequest`. `createMcpHandler` could
// serve both eras from one handler with `legacy: "stateless"`, but then the compatibility path would live inside the
// library behind a flag; routing in front makes the seam real.
//
// REMOVAL CONDITION. Stop passing `isLegacyRequest` when dustinedwards-info's probe (`mcp/scripts/probe-report.mjs`)
// shows the target clients opening with `server/discover` instead of `initialize`. Last measured: Claude Code 2.1.203
// (2026-07-29) and claude.ai (2026-07-30), both LEGACY (initialize, 2025-11-25). Delete on a capture, never on a release
// note. Without `isLegacyRequest` the router is a modern-only server.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Answers one MCP request in the era that can. A request `isLegacyRequest` calls legacy goes to a `legacy: "stateless"`
 * handler (a fresh server per request; GET and DELETE answered 405, as the modern handler does); everything else,
 * malformed envelopes included, to the `legacy: "reject"` handler, which owns those error answers. The predicate reads
 * the body, so it is given a clone. Both handlers are built per call over the same factory.
 *
 * @param {Request} request
 * @param {unknown} env
 * @param {unknown} ctx
 * @param {{ factory: unknown, options: Record<string, unknown>, createMcpHandler: Function, isLegacyRequest?: (request: Request) => Promise<boolean> | boolean }} sdk
 * @returns {Promise<Response>}
 */
export async function routeMcpEra(request, env, ctx, { factory, options, createMcpHandler, isLegacyRequest }) {
  const legacy = isLegacyRequest && (await isLegacyRequest(request.clone())) ? "stateless" : "reject";
  return createMcpHandler(factory, { ...options, legacy })(request, env, ctx);
}

// ---------------------------------------------------------------------------------------------------------------------
// THE API LEG: this Worker to its site, over a service binding. Still HTTP, not an in-process call: the request carries
// the same bearer and crosses the same authentication and rate limit as any other. The bearer identifies WHAT this Worker
// may do and is never the client's OAuth token. A failure here reads differently from a refusal by the API.
// ---------------------------------------------------------------------------------------------------------------------

/** Why the API leg could not produce an answer: not configured, not reachable, or not JSON. Never an API refusal. */
export class ApiLegError extends Error {
  /**
   * @param {string} message
   * @param {"unconfigured" | "unreachable" | "malformed"} kind
   * @param {number} [status] the HTTP status, when an answer came back (malformed)
   */
  constructor(message, kind, status) {
    super(message);
    this.name = "ApiLegError";
    /** @type {"unconfigured" | "unreachable" | "malformed"} */
    this.kind = kind;
    /** @type {number | undefined} */
    this.status = status;
  }
}

/**
 * One request over the API leg, to `SITE_ORIGIN + path` through the `binding` named in `leg`, with the bearer from the
 * `token` var (refused under 32 characters, which the sites' APIs refuse anyway) unless `anonymous`. Returns the status,
 * whether it was 2xx, and the JSON body (null when empty). Throws ApiLegError when unconfigured, unreachable or not JSON.
 *
 * @param {Record<string, unknown>} env
 * @param {{ binding: string, token: string, api: string, userAgent: string, require?: string[] }} leg
 * @param {string} path
 * @param {{ method?: string, headers?: Record<string, string>, json?: unknown, anonymous?: boolean }} [init]
 * @returns {Promise<{ status: number, ok: boolean, body: unknown }>}
 */
export async function callApi(env, leg, path, init = {}) {
  const unconfigured = (/** @type {string} */ what) => new ApiLegError(`The MCP server is not configured: ${what}. Not configured means not open.`, "unconfigured");
  const fetcher = /** @type {{ fetch?: unknown } | undefined} */ (env[leg.binding]);
  if (!fetcher || typeof fetcher.fetch !== "function") throw unconfigured(`the ${leg.binding} service binding is missing`);
  if (!env.SITE_ORIGIN) throw unconfigured("SITE_ORIGIN is unset");
  const token = env[leg.token];
  if (!init.anonymous && (typeof token !== "string" || token.length < 32)) throw unconfigured(`${leg.token} is unset or shorter than 32 characters`);
  for (const name of leg.require ?? []) if (typeof env[name] !== "string" || !String(env[name]).trim()) throw unconfigured(`${name} is unset`);

  const headers = new Headers({ accept: "application/json", "user-agent": leg.userAgent, ...init.headers });
  if (!init.anonymous) headers.set("authorization", `Bearer ${token}`);
  if (init.json !== undefined) headers.set("content-type", "application/json");
  /** @type {Response} */
  let response;
  try {
    response = await /** @type {{ fetch: (url: string, init: RequestInit) => Promise<Response> }} */ (fetcher).fetch(new URL(path, String(env.SITE_ORIGIN)).toString(), {
      method: init.method ?? (init.json === undefined ? "GET" : "POST"),
      headers,
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
    });
  } catch (cause) {
    throw new ApiLegError(`${leg.api} could not be reached: ${cause instanceof Error ? cause.message : String(cause)}`, "unreachable");
  }
  const raw = await response.text();
  try {
    return { status: response.status, ok: response.ok, body: raw ? JSON.parse(raw) : null };
  } catch {
    throw new ApiLegError(`${leg.api} returned status ${response.status} with a body that is not JSON.`, "malformed", response.status);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// THE DOOR'S RATE LIMIT, on the family's one limiter. Verify with a concurrent burst: a sequential loop straddles the
// window boundary and refuses nothing, which reads exactly like a dead limiter.
// ---------------------------------------------------------------------------------------------------------------------

/** Requests one identity may make per minute through the MCP door. */
export const MCP_PER_MINUTE = 30;

/**
 * One request by `identity` (`admin:<email>`, `agent:<name>`, `register:<ip>`). A caller may ask for a lower ceiling
 * (registration does), never a higher one. Fails CLOSED when the binding is missing or failing, and then asks the
 * client to wait the whole window.
 *
 * @param {Parameters<typeof limit>[0]} namespace
 * @param {string} identity
 * @param {number} [perMinute]
 * @returns {Promise<{ allowed: boolean, retryAfter: number }>}
 */
export async function checkRateLimit(namespace, identity, perMinute) {
  const ceiling = perMinute !== undefined && Number.isInteger(perMinute) && perMinute >= 1 && perMinute < MCP_PER_MINUTE ? perMinute : MCP_PER_MINUTE;
  const verdict = await limit(namespace, identity, [{ limit: ceiling, windowSeconds: 60 }], { onUnavailable: "refuse" });
  return { allowed: verdict.status === "ok", retryAfter: verdict.status === "unavailable" ? 60 : verdict.retryAfterSeconds };
}

/**
 * A plain-text refusal that is never cached or indexed.
 * @param {string} body
 * @param {number} status
 * @param {Record<string, string>} [headers]
 */
export function refuse(body, status, headers = {}) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", ...headers },
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// THE DOOR'S OTHER CHECKS. What the libraries already do is theirs: @cloudflare/workers-oauth-provider (1.1.0 and
// later) answers a missing or invalid token 401 with `resource_metadata` and `scope` (the PRM's `scopes_supported`),
// refuses a token bound to another resource, and exports `insufficientScope(ctx.auth, scopes)` for a 403 step-up
// outside the MCP handler. Inside it, the SDK's per-tool `scopeChallenge` (fed below) sends that 403. `agents`'
// createMcpHandler checks Origin against its own hostname list. What follows is only what neither covers.
// ---------------------------------------------------------------------------------------------------------------------

/** @param {string} resource */
function resourceMetadataUrl(resource) {
  const url = new URL(resource);
  return `${url.origin}/.well-known/oauth-protected-resource${url.pathname === "/" ? "" : url.pathname}${url.search}`;
}

/**
 * The 401 Bearer challenge for a door the provider does not guard (an agent-key door, a check after the provider's):
 * `resource_metadata` so the client can find the authorization server, and `scope`, the least a client should ask for.
 * @param {{ resource: string, scope: readonly string[], error?: string, description?: string }} challenge
 */
export function unauthorized({ resource, scope, error, description }) {
  let header = `Bearer resource_metadata="${resourceMetadataUrl(resource)}", scope="${scope.join(" ")}"`;
  if (error) header += `, error="${error}"`;
  if (description) header += `, error_description="${description.replace(/["\\]/g, "")}"`;
  return new Response(error ? JSON.stringify({ error, error_description: description }) : null, {
    status: 401,
    headers: { "content-type": "application/json", "cache-control": "no-store", "www-authenticate": header },
  });
}

/**
 * The token must have been issued for this server (RFC 8707, rule 12.2). The provider already refuses another
 * resource's token; this re-check, against the resource the server expects rather than the one the provider was
 * configured with, means a provider set up for a second resource can never hand this one its token. Null when the
 * audience is `resource`, else the 401.
 * @param {{ audience?: unknown } | undefined} auth the provider's `ctx.auth`
 * @param {string} resource this server's canonical resource, such as `https://mcp.example.com/mcp`
 * @param {readonly string[]} scope the challenge's scope: the read scope
 */
export function audienceRefusal(auth, resource, scope) {
  if (auth?.audience === resource) return null;
  console.warn(JSON.stringify({ door: "refused", reason: "audience", audience: typeof auth?.audience === "string" ? auth.audience : null }));
  return unauthorized({ resource, scope, error: "invalid_token", description: "This token was not issued for this server." });
}

/**
 * The Origin check on every request to the MCP endpoint (DNS rebinding): a missing Origin passes (MCP clients are not
 * browsers), the endpoint's own origin and each of `allowed` (exact origins, such as `https://claude.ai`) pass, and
 * anything else, the string "null" included, is a 403. Null when the request may go on.
 * @param {Request} request
 * @param {readonly string[]} [allowed]
 * @param {Record<string, string>} [headers] added to the refusal
 */
export function mcpOriginRefusal(request, allowed = [], headers) {
  const origin = request.headers.get("Origin");
  if (originVerdict(origin, request.url).ok || (origin !== null && allowed.includes(origin))) return null;
  return originRefusal(headers);
}

// ---------------------------------------------------------------------------------------------------------------------
// LEAST SCOPE FIRST, AND THE PER-CALL OWNERSHIP CHECK (ruling mcp-2026-10-10, rules 12.1 and 12.3). Read is what every
// connection gets; write is ticked on the consent page (or, on dustinedwards-info, named for an agent in AGENT_WRITE).
// Every id a tool takes names a record only the site's administrator owns, so proving the caller owns it is proving the
// caller IS that administrator, on every call: a grant is long lived.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The read and write scopes for a server's scope prefix (`dei` gives `dei.read` and `dei.write`).
 * @param {string} prefix
 */
export function mcpScopes(prefix) {
  const read = `${prefix}.read`;
  const write = `${prefix}.write`;
  return { read, write, all: [read, write] };
}

/**
 * The audit name of a caller: the signed-in email or the agent principal, never a credential.
 * @param {import("./mcp-server.d.mts").McpCaller} caller
 */
export function callerName(caller) {
  if (caller.kind === "person") return `access:${caller.email}`;
  return caller.kind === "admin" ? `access:${caller.props.email}` : `agent:${caller.principal}`;
}

/**
 * The scope a call to `tool` needs, from the scope the server declares on it: `"read"`, `"write"`, the server's own
 * scope string, or a function of the arguments where the action decides. Null when it declares none. Never read from
 * `readOnlyHint`: annotations describe a tool to the client and are not an authorization, so a wrong one cannot open
 * a write.
 * @param {{ scope?: unknown }} tool
 * @param {Record<string, unknown>} args
 * @param {{ read: string, write: string }} scopes
 * @returns {string | null}
 */
export function toolScope(tool, args, scopes) {
  const declared = typeof tool.scope === "function" ? tool.scope(args) : tool.scope;
  if (declared === "read" || declared === scopes.read) return scopes.read;
  if (declared === "write" || declared === scopes.write) return scopes.write;
  return null;
}

/**
 * The tools a grant holding `held` can call, for a server that lists only those (a read-only grant sees no write
 * tool). A tool whose action decides its scope stays for a read grant; one with no scope is dropped. Such a list
 * differs by grant, so its `tools/list` cache hint must be private (`mcpCacheHints`).
 * @template {{ scope?: unknown }} T
 * @param {readonly T[]} tools
 * @param {readonly string[]} held
 * @param {{ read: string, write: string }} scopes
 * @returns {T[]}
 */
export function toolsForGrant(tools, held, scopes) {
  return tools.filter((tool) => {
    const scope = typeof tool.scope === "function" ? scopes.read : toolScope(tool, {}, scopes);
    return scope !== null && held.includes(scope);
  });
}

/**
 * Null when the call may proceed, or the refusal to show the caller. A tool with no declared scope never runs. A
 * `person` is one the server's door already verified (a server with several people), so only the grant's scopes decide.
 * @param {{ ADMIN_EMAIL?: string }} env
 * @param {import("./mcp-server.d.mts").McpCaller | undefined} caller
 * @param {string | null | undefined} scope
 * @param {{ site: string, scopes: { read: string, write: string } }} server
 * @returns {string | null}
 */
export function authorizeCall(env, caller, scope, { site, scopes }) {
  if (scope !== scopes.read && scope !== scopes.write) return "Refused: this tool declares no scope, so it does not run. This is a fault in the server, not the connection.";
  if (!caller) return "Refused: no caller identity reached this tool call. Connect again through the OAuth flow.";
  if (caller.kind === "admin" && !isAdminUser(env, caller.props)) {
    return `Refused: this grant does not belong to the administrator of ${site}, so it owns none of the records this tool names.`;
  }
  if (caller.kind === "agent" && !/^[a-z0-9][a-z0-9_-]*$/.test(caller.principal)) return "Refused: the agent principal is malformed.";
  if (caller.scopes.includes(scope)) return null;
  if (scope !== scopes.write) return "Refused: this connection holds no read scope. Reconnect through the OAuth flow.";
  return caller.kind === "agent"
    ? `Refused: this agent key holds read access only (${scopes.read}), and this tool changes ${site}. Add the agent's name to AGENT_WRITE.`
    : `Refused: this connection holds read access only (${scopes.read}), and this tool changes ${site}. Reconnect and tick "Allow changes" on the consent page.`;
}

/**
 * The SDK's per-tool `scopeChallenge` (`registerTool(name, { ..., scopeChallenge: toolScopeChallenge(env, server,
 * tool) }, ...)`): when an OAuth token lacks the scope the call needs, the transport answers 403 `insufficient_scope`
 * naming every scope the call needs (a write needs both) with `resource_metadata`, before the tool runs, and the client
 * can step up instead of reconnecting by hand. The challenge is logged. An agent key carries no OAuth token, so it gets
 * no challenge and `authorizeCall` refuses it in words.
 * @param {Partial<import("./audit-log.d.mts").AuditEnv>} env
 * @param {import("./mcp-server.d.mts").McpServerInfo} server
 * @param {{ name: string, scope?: unknown }} tool
 */
export function toolScopeChallenge(env, server, tool) {
  /** @param {{ request: { params?: Record<string, unknown> }, authInfo?: { scopes: string[], clientId?: string, extra?: Record<string, unknown> } }} context */
  return async ({ request, authInfo }) => {
    const args = /** @type {Record<string, unknown>} */ (request.params?.arguments ?? {});
    const scope = toolScope(tool, args, server.scopes);
    if (!authInfo || scope === null || authInfo.scopes.includes(scope)) return undefined;
    const needed = scope === server.scopes.write ? [server.scopes.read, server.scopes.write] : [server.scopes.read];
    const props = /** @type {{ email?: unknown } | undefined} */ (authInfo.extra?.props);
    await recordAudit(env, {
      callId: crypto.randomUUID(),
      phase: "scope-challenge",
      caller: typeof props?.email === "string" ? `access:${props.email}` : "unknown",
      tool: tool.name,
      args: await loggedArgs(args),
      result: { isError: true, text: `needs ${needed.join(" ")}` },
      server: { name: server.name, version: server.version },
      clientId: authInfo.clientId,
      correlationId: correlationId(/** @type {Record<string, unknown> | undefined} */ (request.params?._meta)),
    });
    return { scopes: needed, errorDescription: `This tool needs ${needed.join(" ")}. Allow changes when you reconnect.` };
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// THE ONE DOOR TO A TOOL HANDLER (rule 12.4). In order: prove the caller owns what the tool names and holds its scope
// (a refusal is logged and nothing is sent), write the `started` row (and refuse if the log cannot be written, so no
// call runs unlogged), run the tool, write the `finished` row (also when the tool throws, before the error goes on).
// Rows name the caller and never carry a credential.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * One tool call through the scope check and the log. `run` is the server's own handler; `meta` is the request's
 * `_meta` (`ctx.mcpReq._meta`), whose traceparent becomes the rows' correlation id.
 * @template {{ isError?: boolean, content: Array<{ type: "text", text: string }> }} O
 * @param {{ ADMIN_EMAIL?: string } & Partial<import("./audit-log.d.mts").AuditEnv>} env
 * @param {import("./mcp-server.d.mts").McpServerInfo} server
 * @param {{ caller: import("./mcp-server.d.mts").McpCaller | undefined, tool: { name: string, scope?: unknown }, args: Record<string, unknown>, meta?: Record<string, unknown>, run: () => Promise<O> }} call
 * @returns {Promise<O | { isError: true, content: Array<{ type: "text", text: string }> }>}
 */
export async function invokeTool(env, server, { caller, tool, args, meta, run }) {
  const failed = (/** @type {string} */ text) => ({ isError: /** @type {const} */ (true), content: [{ type: /** @type {const} */ ("text"), text }] });
  const refused = authorizeCall(env, caller, toolScope(tool, args, server.scopes), server);
  const clientId = caller?.kind === "admin" ? caller.props.clientId : caller?.kind === "person" ? caller.clientId : undefined;
  /** @type {Omit<import("./audit-log.d.mts").AuditRow, "phase">} */
  const row = {
    callId: crypto.randomUUID(),
    caller: caller ? callerName(caller) : "unknown",
    tool: tool.name,
    args: await loggedArgs(args),
    server: { name: server.name, version: server.version },
    clientId: typeof clientId === "string" ? clientId : undefined,
    correlationId: correlationId(meta),
  };

  if (refused || !caller) {
    const output = failed(refused ?? "Refused.");
    await recordAudit(env, { ...row, phase: "refused", result: loggedResult(output) });
    return output;
  }
  try {
    await appendAudit(env, { ...row, phase: "started" });
  } catch (cause) {
    return failed(
      `Refused: the tool-call log could not be written (${cause instanceof Error ? cause.message : String(cause)}), ` +
        `and no tool runs unlogged. Nothing was sent to ${server.site}.`,
    );
  }
  /** @type {O} */
  let output;
  try {
    output = await run();
  } catch (error) {
    // A handler that throws still ends its call in the log; the error goes on to the SDK, which answers it.
    await recordAudit(env, { ...row, phase: "finished", result: { isError: true, text: `threw: ${error instanceof Error ? error.message : String(error)}`.slice(0, 1000) } });
    throw error;
  }
  await recordAudit(env, { ...row, phase: "finished", result: loggedResult(output) });
  return output;
}

// ---------------------------------------------------------------------------------------------------------------------
// LIST CACHE HINTS (MCP 2026-07-28). The SDK's `cacheHints` server option stamps `ttlMs` and `cacheScope` on the
// cacheable results of 2026-era requests; without it they go out as `ttlMs: 0`, private.
// ---------------------------------------------------------------------------------------------------------------------

const CACHEABLE = /** @type {const} */ (["tools/list", "prompts/list", "resources/list", "resources/templates/list", "resources/read", "server/discover"]);

/**
 * The `cacheHints` option: every cacheable result lives `ttlMs`, private to the requesting client unless named in
 * `shared` (the same for every caller, so a shared cache may keep it). Private is the default because a list filtered
 * by the grant (`toolsForGrant`, a caller's namespaces) served from a shared cache is one person's list shown to
 * another.
 * @param {{ ttlMs?: number, shared?: ReadonlyArray<typeof CACHEABLE[number]> }} [options]
 */
export function mcpCacheHints({ ttlMs = 60_000, shared = [] } = {}) {
  return Object.fromEntries(CACHEABLE.map((method) => [method, { ttlMs, cacheScope: shared.includes(method) ? "public" : "private" }]));
}
