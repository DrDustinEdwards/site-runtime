/**
 * The MCP servers' tool-call log: an append-only log of every tool call, with the caller, the arguments and the result
 * (ruling mcp-2026-10-10, rule 12.4), and of the door's own events: a sign-in, a scope challenge, a rate-limited request.
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
 * arguments and the result, the server's name and version, the OAuth client id and a correlation id (the trace id of
 * the request's `_meta.traceparent`, else a fresh one). A long string argument is stored as its length and a SHA-256
 * prefix, enough to prove which bytes were sent without keeping a second copy of the content. Every value is a bound
 * parameter in its own column and the arguments and result are JSON, so a CR or LF in them is data, never a new row.
 *
 * Tamper evidence: each row's `hash` covers the previous row's hash and this row's values (`verifyAuditChain`). It is
 * HMAC-SHA-256 under the Worker secret `AUDIT_CHAIN_KEY` when one is bound, else plain SHA-256.
 * - Plain SHA-256 catches a row changed or removed by someone who does not recompute the hashes after it (a slip in the
 *   data view, a partial restore). Anyone who can edit the table can recompute them, so it proves nothing against a
 *   deliberate editor.
 * - The HMAC also catches a deliberate editor who can change the table (the dashboard, an edited export) but cannot
 *   read the secret. Code deployed to the Worker can read it, and so could rewrite the chain.
 * Neither catches rows cut off the end, which leaves a valid chain. Rows written before the hash column have none. Bind
 * the key before the first hashed row: a plain row would let an editor pass plain rows off as the whole chain, so the
 * check with the key accepts none.
 */

import { sha256Hex, toHex } from "./encoding.mjs";

const LONG_STRING = 200;
const RESULT_CHARS = 1000;
const FIELD_CHARS = 200;

// The columns added after the table first shipped, each nullable, so an existing log migrates in place.
const ADDED = ["server", "version", "client_id", "correlation_id", "hash"];
// The values a row's hash covers, in this order.
const HASHED = ["at", "call_id", "phase", "caller", "tool", "args", "result", "server", "version", "client_id", "correlation_id"];

/** The Durable Object class a Worker exports (as ToolCallLog) and binds as TOOL_CALL_LOG. */
export class ToolCallLog {
  /**
   * @param {DurableObjectState} state
   * @param {Partial<import("./audit-log.d.mts").AuditEnv>} [env]
   */
  constructor(state, env) {
    this.sql = state.storage.sql;
    this.key = env?.AUDIT_CHAIN_KEY || null;
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS calls (" +
        "seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, call_id TEXT NOT NULL, " +
        "phase TEXT NOT NULL, caller TEXT NOT NULL, tool TEXT NOT NULL, args TEXT NOT NULL, result TEXT)",
    );
    const have = new Set(this.sql.exec("PRAGMA table_info(calls)").toArray().map((column) => column.name));
    for (const name of ADDED) if (!have.has(name)) this.sql.exec(`ALTER TABLE calls ADD COLUMN ${name} TEXT`);
    // Appends run one at a time: each reads the hash the one before it wrote.
    /** @type {Promise<unknown>} */
    this.tail = Promise.resolve();
  }

  /** @param {Request} request */
  async fetch(request) {
    if (request.method !== "POST") return new Response("append only", { status: 405 });
    const row = /** @type {import("./audit-log.d.mts").AuditRow} */ (await request.json());
    const append = this.tail.then(() => this.append(row));
    this.tail = append.catch(() => {});
    await append;
    return new Response(null, { status: 204 });
  }

  /** @param {import("./audit-log.d.mts").AuditRow} row */
  async append(row) {
    const field = (/** @type {unknown} */ value) => (value === undefined || value === null ? null : String(value).slice(0, FIELD_CHARS));
    /** @type {Record<string, string | null>} */
    const values = {
      at: new Date().toISOString(),
      call_id: String(row.callId),
      phase: String(row.phase),
      caller: String(row.caller).slice(0, FIELD_CHARS),
      tool: String(row.tool ?? "").slice(0, FIELD_CHARS),
      args: JSON.stringify(row.args ?? {}),
      result: row.result === undefined ? null : JSON.stringify(row.result),
      server: field(row.server?.name),
      version: field(row.server?.version),
      client_id: field(row.clientId),
      correlation_id: field(row.correlationId),
    };
    const last = this.sql.exec("SELECT hash FROM calls ORDER BY seq DESC LIMIT 1").toArray()[0];
    const hash = await rowHash(/** @type {string | null} */ (last?.hash ?? null), values, this.key);
    this.sql.exec(
      `INSERT INTO calls (${HASHED.join(", ")}, hash) VALUES (${HASHED.map(() => "?").join(", ")}, ?)`,
      ...HASHED.map((name) => values[name]),
      hash,
    );
  }
}

/**
 * A row's link in the chain: the HMAC (with `key`) or SHA-256 of the previous hash and the row's stored values.
 * @param {string | null} previous
 * @param {Record<string, unknown>} row
 * @param {string | null} key
 */
async function rowHash(previous, row, key) {
  const text = new TextEncoder().encode(`${previous ?? ""}\n${JSON.stringify(HASHED.map((name) => row[name] ?? null))}`);
  if (!key) return sha256Hex(text);
  const hmac = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", hmac, text));
}

/**
 * Checks the hash chain over rows as the table holds them, in `seq` order (an export from the data view), with
 * `AUDIT_CHAIN_KEY` when the log has one. Rows from before the hash column are skipped; after the first hashed row,
 * every row must carry the hash its values and the row before it make.
 * @param {Array<Record<string, unknown>>} rows
 * @param {string} [key]
 * @returns {Promise<{ ok: true, hashed: number } | { ok: false, seq: unknown }>}
 */
export async function verifyAuditChain(rows, key) {
  /** @type {string | null} */
  let previous = null;
  let hashed = 0;
  for (const row of rows) {
    if (row.hash == null && previous === null) continue;
    if (row.hash !== (await rowHash(previous, row, key || null))) return { ok: false, seq: row.seq };
    previous = /** @type {string} */ (row.hash);
    hashed++;
  }
  return { ok: true, hashed };
}

/**
 * The correlation id of one request: the trace id of its W3C `_meta.traceparent` when that is well formed, else a
 * fresh id of the same shape, so the log and a tracing system name a call alike.
 * @param {Record<string, unknown> | undefined} [meta]
 */
export function correlationId(meta) {
  const match = /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/.exec(String(meta?.traceparent ?? ""));
  if (match && !/^0+$/.test(match[1])) return match[1];
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * The arguments as the log stores them: long strings become their length and a digest prefix.
 * @param {Record<string, unknown>} args
 */
export async function loggedArgs(args) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, value] of Object.entries(args)) {
    out[key] = typeof value === "string" && value.length > LONG_STRING ? { chars: value.length, sha256: (await sha256Hex(value)).slice(0, 16) } : value;
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

/**
 * Appends a row whose failure changes nothing the caller does (a refusal, a sign-in, a challenge, a rate limit): a
 * failed write goes to the Worker log instead of throwing.
 * @param {Partial<import("./audit-log.d.mts").AuditEnv>} env
 * @param {import("./audit-log.d.mts").AuditRow} row
 */
export async function recordAudit(env, row) {
  await appendAudit(env, row).catch((cause) =>
    console.error(JSON.stringify({ audit: "tool-call-log-write-failed", phase: row.phase, callId: row.callId, caller: row.caller, tool: row.tool, error: String(cause) })),
  );
}
