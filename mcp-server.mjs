// The admin MCP servers' shared scaffold (shared-code sweep round 2, item 4): the era router with its prior-era shim, the
// API leg's transport, the rate limit on the MCP door, and the per-call scope check. Each admin MCP (dustinedwards-info,
// foxing) is a wrapper over its site's own API, which owns every rule; nothing here interprets one.
//
// No dependency, like the rest of the package: the MCP SDK and `agents` are the caller's, and the era router is handed
// their two functions.

import { limit } from "./rate-limit/limit.mjs";
import { isAdminUser } from "./mcp-login.mjs";

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
 * @param {{ kind: "admin", props: { email: string } } | { kind: "agent", principal: string }} caller
 */
export function callerName(caller) {
  return caller.kind === "admin" ? `access:${caller.props.email}` : `agent:${caller.principal}`;
}

/**
 * Null when the call may proceed, or the refusal to show the caller.
 * @param {{ ADMIN_EMAIL?: string }} env
 * @param {({ kind: "admin", props: { email: string }, scopes: readonly string[] } | { kind: "agent", principal: string, scopes: readonly string[] }) | undefined} caller
 * @param {string} scope
 * @param {{ site: string, scopes: { read: string, write: string } }} server
 * @returns {string | null}
 */
export function authorizeCall(env, caller, scope, { site, scopes }) {
  if (!caller) return "Refused: no caller identity reached this tool call. Connect again through the OAuth flow.";
  if (caller.kind === "admin" && !isAdminUser(env, caller.props)) {
    return `Refused: this grant does not belong to the administrator of ${site}, so it owns none of the records this tool names.`;
  }
  if (caller.kind === "agent" && !/^[a-z0-9_]+$/.test(caller.principal)) return "Refused: the agent principal is malformed.";
  if (caller.scopes.includes(scope)) return null;
  if (scope !== scopes.write) return "Refused: this connection holds no read scope. Reconnect through the OAuth flow.";
  return caller.kind === "agent"
    ? `Refused: this agent key holds read access only (${scopes.read}), and this tool changes ${site}. Add the agent's name to AGENT_WRITE.`
    : `Refused: this connection holds read access only (${scopes.read}), and this tool changes ${site}. Reconnect and tick "Allow changes" on the consent page.`;
}
