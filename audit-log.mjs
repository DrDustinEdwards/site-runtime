/**
 * The MCP servers' tool-call log: an append-only log of every tool call, with the caller, the arguments and the result
 * (ruling mcp-2026-10-10, rule 12.4).
 *
 * A Durable Object with synchronous SQLite, one instance for the Worker. The class has exactly one write, an INSERT,
 * and no UPDATE, DELETE or read path over HTTP, so nothing that reaches the Worker can rewrite a row. Read it in the
 * Cloudflare dashboard's Durable Object data view.
 *
 * A refused call is one `refused` row and sent nothing on. An allowed call is two rows: `started` is written before the
 * API is called, and the call is refused if that write fails, so no tool runs unlogged. `finished` carries the result;
 * if that write fails the call has already happened, so the failure goes to the Worker log.
 *
 * A row carries the caller's audit name (a signed-in email or an agent principal, never a credential), the tool, the
 * arguments and the result. A long string argument is stored as its length and a SHA-256 prefix, enough to prove which
 * bytes were sent without keeping a second copy of the content.
 */

const LONG_STRING = 200;
const RESULT_CHARS = 1000;

/** The Durable Object class a Worker exports (as ToolCallLog) and binds as TOOL_CALL_LOG. */
export class ToolCallLog {
  /** @param {DurableObjectState} state */
  constructor(state) {
    this.sql = state.storage.sql;
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS calls (" +
        "seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, call_id TEXT NOT NULL, " +
        "phase TEXT NOT NULL, caller TEXT NOT NULL, tool TEXT NOT NULL, args TEXT NOT NULL, result TEXT)",
    );
  }

  /** @param {Request} request */
  async fetch(request) {
    if (request.method !== "POST") return new Response("append only", { status: 405 });
    const row = /** @type {import("./audit-log.d.mts").AuditRow} */ (await request.json());
    this.sql.exec(
      "INSERT INTO calls (at, call_id, phase, caller, tool, args, result) VALUES (?, ?, ?, ?, ?, ?, ?)",
      new Date().toISOString(),
      String(row.callId),
      String(row.phase),
      String(row.caller),
      String(row.tool),
      JSON.stringify(row.args ?? {}),
      row.result === undefined ? null : JSON.stringify(row.result),
    );
    return new Response(null, { status: 204 });
  }
}

/** @param {string} text */
async function digest(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...bytes.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The arguments as the log stores them: long strings become their length and a digest prefix.
 * @param {Record<string, unknown>} args
 */
export async function loggedArgs(args) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, value] of Object.entries(args)) {
    out[key] = typeof value === "string" && value.length > LONG_STRING ? { chars: value.length, sha256: await digest(value) } : value;
  }
  return out;
}

/**
 * The result as the log stores it: whether it failed, and the start of its text.
 * @param {{ isError?: boolean, content: Array<{ text: string }> }} output
 */
export function loggedResult(output) {
  const text = output.content.map((c) => c.text).join("\n");
  return { isError: output.isError === true, text: text.slice(0, RESULT_CHARS) };
}

/**
 * Appends one row. Throws when the binding is missing or the write fails, so the caller decides: a failed `started`
 * refuses the call, a failed `finished` is reported to the Worker log.
 * @param {Partial<import("./audit-log.d.mts").AuditEnv>} env
 * @param {import("./audit-log.d.mts").AuditRow} row
 */
export async function appendAudit(env, row) {
  if (!env.TOOL_CALL_LOG) throw new Error("the TOOL_CALL_LOG binding is missing");
  const stub = env.TOOL_CALL_LOG.get(env.TOOL_CALL_LOG.idFromName("tool-calls"));
  const response = await stub.fetch("https://tool-call-log.invalid/append", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(row),
  });
  if (response.status !== 204) throw new Error(`the tool-call log answered ${response.status}`);
}
