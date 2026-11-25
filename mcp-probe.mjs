/**
 * The list-only test key's door (./agent-keys `isProbeKey`): what such a key may send and the answer it gets.
 * ./mcp-server re-exports what a caller imports.
 */

import { correlationId, recordAudit } from "./audit-log.mjs";
import { isProbeKey, PROBE_PRINCIPAL, probeCaller } from "./agent-keys.mjs";
import { readCappedBytes } from "./body.mjs";
/** @typedef {import("./mcp-server.mjs").McpServerInfo} McpServerInfo */
import { MCP_PER_MINUTE, checkRateLimit, refuse } from "./mcp-server.mjs";

// THE LIST-ONLY TEST KEY'S DOOR (./agent-keys `isProbeKey`). The key may open a connection, read the server's lists and
// send a tools/call that the server refuses; any other method is answered here, before the SDK sees the request, as the
// method a server does not have (404, -32601), and logged. An allowlist, so a new protocol method is refused until named.
//
// WHY tools/call PASSES. The protocol layer validates a request first: a Mcp-Method or Mcp-Name header that does not
// match the body is a 400 (-32020, SEP-2243), a method the server lacks a 404 (-32601, SEP-2575). A door that refused
// tools/call first answered those 403 and broke both MUSTs. Past the SDK's checks
// `invokeTool` refuses the probe caller before `run`, with a `refused` row, so the key still runs nothing.

/** The methods the list-only test key may send on to the server (tools/call is refused by `invokeTool`, see above). */
export const PROBE_METHODS = new Set([
  "initialize",
  "ping",
  "server/discover",
  "tools/list",
  "tools/call",
  "resources/list",
  "resources/templates/list",
  "prompts/list",
  "subscriptions/listen",
  "notifications/initialized",
  "notifications/cancelled", // codespell:ignore (the protocol's method name)
]);

/** The largest body the test key's door reads. */
const PROBE_BODY_MAX = 64 * 1024;

/**
 * The list-only test key's request, checked: `{ request }` to serve (its body already read), or `{ refusal }`: a 403
 * JSON-RPC error for a body over 64 KiB, and for a method `PROBE_METHODS` does not list a 404 with -32601. A refused
 * notification is a 403, as it has no id to answer. Each refused message is a `refused` row in the log, under
 * `probe:live-check`. A body that is not JSON goes on, for the SDK's parse error.
 * @param {Partial<import("./audit-log.mjs").AuditEnv>} env
 * @param {McpServerInfo} server
 * @param {Request} request
 * @returns {Promise<{ request: Request, refusal?: undefined } | { refusal: Response, request?: undefined }>}
 */
export async function probeRefusal(env, server, request) {
  const refusal = (
    /** @type {unknown} */ id,
    /** @type {number} */ status,
    /** @type {number} */ code,
    /** @type {string} */ message,
  ) => ({
    refusal: new Response(
      JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }),
      {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      },
    ),
  });
  if (request.method !== "POST") return { request };
  const bytes = await readCappedBytes(request, PROBE_BODY_MAX);
  if (bytes === null)
    return refusal(null, 403, -32600, "Refused: the list-only test key's request is too large.");
  const text = new TextDecoder().decode(bytes);
  const served = new Request(request, { method: "POST", body: text });
  /** @type {unknown} */
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { request: served };
  }
  const messages = (Array.isArray(body) ? body : [body]).filter((m) => m && typeof m === "object");
  const refused = messages.filter(
    (m) => !PROBE_METHODS.has(String(/** @type {{ method?: unknown }} */ (m).method ?? "")),
  );
  if (!refused.length) return { request: served };
  const words = `Refused: this is the list-only test key for ${server.site}. It can list tools and never runs one.`;
  for (const message of refused) {
    const { method, params } =
      /** @type {{ method?: unknown, params?: { _meta?: Record<string, unknown> } }} */ (message);
    await recordAudit(env, {
      callId: crypto.randomUUID(),
      phase: "refused",
      caller: `probe:${PROBE_PRINCIPAL}`,
      tool: String(method ?? "no method"),
      result: { isError: true, text: words },
      server: { name: server.name, version: server.version },
      correlationId: correlationId(params?._meta),
    });
  }
  const first = /** @type {{ id?: unknown }} */ (refused[0]);
  return first.id === undefined
    ? refusal(null, 403, -32600, words)
    : refusal(first.id, 404, -32601, `Method not found. ${words}`);
}

/**
 * The list-only test key's whole door, for a server's `/mcp` before its OAuth provider: null when the request does not
 * carry the key. Otherwise the limiter (fails closed; a limited request is a `rate-limited` row), then `probeRefusal`,
 * then `serve(request, probeCaller())`.
 * @template {Partial<import("./audit-log.mjs").AuditEnv>} E
 * @param {Request} request
 * @param {E} env
 * @param {{ server: McpServerInfo, limiter: Parameters<typeof checkRateLimit>[0], serve: (request: Request, caller: { kind: "probe", principal: string, scopes: string[] }) => Promise<Response> }} options
 * @returns {Promise<Response | null>}
 */
export async function probeDoor(request, env, { server, limiter, serve }) {
  if (
    !(await isProbeKey(
      /** @type {Record<string, unknown>} */ (env),
      request.headers.get("authorization"),
    ))
  )
    return null;
  const limit = await checkRateLimit(limiter, `probe:${PROBE_PRINCIPAL}`);
  if (!limit.allowed) {
    await recordAudit(env, {
      callId: crypto.randomUUID(),
      phase: "rate-limited",
      caller: `probe:${PROBE_PRINCIPAL}`,
      server: { name: server.name, version: server.version },
    });
    return refuse(
      `Rate limited. ${server.site}'s MCP allows ${MCP_PER_MINUTE} requests a minute.`,
      429,
      { "retry-after": String(limit.retryAfter) },
    );
  }
  const checked = await probeRefusal(env, server, request);
  return checked.refusal ?? serve(checked.request, probeCaller());
}
