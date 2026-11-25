/** The MCP wire the audit speaks: the protocol version, the discovery request and one request's envelope and answer. */

/**
 * @typedef {object} Ctx what an audit part needs from the run: its request and its findings
 * @property {(url: string, init?: RequestInit) => Promise<{ url: string, res: Response | null, why: string }>} get
 * @property {(severity: "error" | "warning" | "unmeasured", item: string, url: string, detail: string) => unknown} report
 */

export const TIMEOUT_MS = 10_000;
export const VERSION = "2026-07-28";
export const DISCOVER = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "server/discover",
  params: {
    _meta: {
      "io.modelcontextprotocol/protocolVersion": VERSION,
      "io.modelcontextprotocol/clientCapabilities": {},
    },
  },
});
export const MCP_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  "mcp-protocol-version": VERSION,
  "mcp-method": "server/discover",
};

/** A modern-era request's body: the method, its params, and the per-request envelope. */
export function envelope(
  /** @type {string} */ method,
  /** @type {Record<string, unknown>} */ params = {},
) {
  const meta = {
    "io.modelcontextprotocol/protocolVersion": VERSION,
    "io.modelcontextprotocol/clientInfo": { name: "site-runtime-ai-audit", version: "1" },
    "io.modelcontextprotocol/clientCapabilities": {},
  };
  return JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: meta } });
}

/** The JSON-RPC message of an answer sent as JSON or as one server-sent event. */
export async function rpcOf(/** @type {Response} */ res) {
  const text = await res.text().catch(() => "");
  if (!/event-stream/i.test(res.headers.get("content-type") ?? "")) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    try {
      const message = JSON.parse(line.slice(5).trim());
      if (message && ("result" in message || "error" in message)) return message;
    } catch {}
  }
  return null;
}

/** The body as a JSON object, or null when it is not one. */
export async function jsonOf(/** @type {Response} */ res) {
  try {
    const body = await res.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}
