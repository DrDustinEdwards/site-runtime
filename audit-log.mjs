/**
 * The MCP servers' tool-call log: an append-only log of every tool call, with the caller, the arguments and the result
 * (ruling mcp-2026-10-10, rule 12.4), and of the door's own events: a sign-in, a scope challenge, a rate-limited request.
 *
 * A Durable Object with synchronous SQLite, one instance for the Worker, reached only from the Worker's own code. It
 * has no UPDATE: a row is written once and never changed. Its one DELETE is retention (L7), and it removes only rows
 * already copied out (L6) and older than the retention period. Read it on the server's owner page (./owner-page, L9),
 * in the Cloudflare dashboard's Durable Object data view, or in the copies.
 *
 * - EXPORT (L6). `exportAuditLog(env, bucket)`, from the Worker's cron, copies the rows not yet copied to R2, one JSON
 *   object per batch at `<prefix><first seq>-<last seq>.json` (`{ previous, rows }`, `previous` the hash of the row
 *   before the first, so `verifyAuditChain(rows, key, previous)` checks each copy on its own). Put an object lock (a
 *   bucket lock rule, as the backups have) on the prefix, so the copy cannot be changed or removed inside its period.
 *   Only then does the log mark the rows copied.
 * - RETENTION (L7). After each copy, rows that are copied and older than `keepDays` (AUDIT_KEEP_DAYS, 90) are deleted.
 *   A row never copied is never deleted, however old.
 * - ALERT (L8). `auditLogCheck(env)` is a /health check, level warn and alert: it fails when a `started` row has had no
 *   `finished` row for 15 minutes (a call ran and the log stopped hearing of it), when calls in the last hour pass
 *   `spikePerHour`, or when rows have waited more than two days for a copy.
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
/** Days a copied row stays in the log (L7). */
export const AUDIT_KEEP_DAYS = 90;
const EXPORT_BATCH = 1000;
const EXPORT_BATCHES = 20;
const ORPHAN_MINUTES = 15;
const EXPORT_LATE_DAYS = 2;
const RESULT_CHARS = 1000;
const FIELD_CHARS = 200;
const RECENT_PAGE = 50;
const RECENT_MAX = 100;

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
    // How far the copy has got: the last copied row's seq and hash, and when.
    this.sql.exec("CREATE TABLE IF NOT EXISTS export_state (id INTEGER PRIMARY KEY CHECK (id = 1), seq INTEGER NOT NULL, hash TEXT, at TEXT NOT NULL)");
    // Appends run one at a time: each reads the hash the one before it wrote.
    /** @type {Promise<unknown>} */
    this.tail = Promise.resolve();
  }

  /** @param {Request} request */
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/stats") return Response.json(this.stats());
    if (request.method === "GET" && path === "/recent") {
      const query = new URL(request.url).searchParams;
      return Response.json({ rows: this.recent(Number(query.get("before")) || 0, Number(query.get("limit")) || RECENT_PAGE) });
    }
    if (request.method !== "POST") return new Response("append only", { status: 405 });
    if (path === "/export") return Response.json(this.unexported(Number((await request.json()).limit) || EXPORT_BATCH));
    if (path === "/exported") {
      const { seq, hash, keepDays } = /** @type {{ seq: number, hash: string | null, keepDays?: number }} */ (await request.json());
      return Response.json(this.markExported(seq, hash, keepDays ?? AUDIT_KEEP_DAYS));
    }
    const row = /** @type {import("./audit-log.d.mts").AuditRow} */ (await request.json());
    const append = this.tail.then(() => this.append(row));
    this.tail = append.catch(() => {});
    await append;
    return new Response(null, { status: 204 });
  }

  /**
   * The rows after the last copied one, oldest first, and the hash before them.
   * @param {number} limit
   */
  unexported(limit) {
    const mark = this.sql.exec("SELECT seq, hash FROM export_state WHERE id = 1").toArray()[0];
    const rows = this.sql.exec("SELECT * FROM calls WHERE seq > ? ORDER BY seq LIMIT ?", Number(mark?.seq ?? 0), Math.min(Math.max(1, limit), EXPORT_BATCH)).toArray();
    return { previous: mark?.hash ?? null, rows };
  }

  /**
   * Marks the rows through `seq` copied, then deletes the copied rows older than `keepDays`, except the newest row, which
   * the next append chains to. Never moves the mark back.
   * @param {number} seq
   * @param {string | null} hash
   * @param {number} keepDays
   */
  markExported(seq, hash, keepDays) {
    const at = new Date();
    const mark = Number(this.sql.exec("SELECT seq FROM export_state WHERE id = 1").toArray()[0]?.seq ?? 0);
    if (Number.isInteger(seq) && seq > mark) {
      this.sql.exec("INSERT INTO export_state (id, seq, hash, at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET seq = excluded.seq, hash = excluded.hash, at = excluded.at", seq, hash, at.toISOString());
    }
    const through = Math.max(mark, Number.isInteger(seq) ? seq : 0);
    const cutoff = new Date(at.getTime() - Math.max(1, keepDays) * 86_400_000).toISOString();
    // The newest row stays whatever its age: the next append chains to it.
    const pruned = this.sql.exec("DELETE FROM calls WHERE seq <= ? AND at < ? AND seq < (SELECT max(seq) FROM calls) RETURNING seq", through, cutoff).toArray().length;
    return { through, pruned };
  }

  /**
   * Up to `limit` rows (at most 100) before the row `before` (0: the newest), newest first: what an owner page shows.
   * @param {number} before
   * @param {number} limit
   */
  recent(before, limit) {
    const n = Math.min(Math.max(1, Math.floor(limit)), RECENT_MAX);
    const columns = "seq, at, call_id, phase, caller, tool, args, result, server, version, client_id, correlation_id";
    return before > 0
      ? this.sql.exec(`SELECT ${columns} FROM calls WHERE seq < ? ORDER BY seq DESC LIMIT ?`, Math.floor(before), n).toArray()
      : this.sql.exec(`SELECT ${columns} FROM calls ORDER BY seq DESC LIMIT ?`, n).toArray();
  }

  /**
   * What the alert reads: calls in the last hour, `started` rows with no `finished` after ORPHAN_MINUTES, and the rows
   * waiting for a copy with the oldest one's time.
   */
  stats() {
    const now = Date.now();
    const iso = (/** @type {number} */ ms) => new Date(now - ms).toISOString();
    const one = (/** @type {string} */ query, /** @type {unknown[]} */ ...params) => this.sql.exec(query, ...params).toArray()[0] ?? {};
    const mark = Number(one("SELECT seq FROM export_state WHERE id = 1").seq ?? 0);
    const waiting = one("SELECT count(*) AS n, min(at) AS oldest FROM calls WHERE seq > ?", mark);
    return {
      lastHour: Number(one("SELECT count(*) AS n FROM calls WHERE phase = 'started' AND at >= ?", iso(3_600_000)).n ?? 0),
      orphans: Number(
        one(
          "SELECT count(*) AS n FROM calls s WHERE s.phase = 'started' AND s.at < ? AND s.at >= ? " +
            "AND NOT EXISTS (SELECT 1 FROM calls f WHERE f.call_id = s.call_id AND f.phase = 'finished')",
          iso(ORPHAN_MINUTES * 60_000),
          iso(86_400_000),
        ).n ?? 0,
      ),
      unexported: Number(waiting.n ?? 0),
      oldestUnexported: waiting.oldest ?? null,
    };
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
 * `previous` is the hash of the row before the first given one, for a copy that starts mid-chain (`exportAuditLog`'s).
 * @param {Array<Record<string, unknown>>} rows
 * @param {string} [key]
 * @param {string | null} [anchor]
 * @returns {Promise<{ ok: true, hashed: number } | { ok: false, seq: unknown }>}
 */
export async function verifyAuditChain(rows, key, anchor = null) {
  /** @type {string | null} */
  let previous = anchor;
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
 * The log's one instance.
 * @param {Partial<import("./audit-log.d.mts").AuditEnv>} env
 * @returns {{ fetch(input: string, init?: RequestInit): Promise<Response> }}
 */
function logStub(env) {
  const ns = /** @type {any} */ (env.TOOL_CALL_LOG);
  if (!ns) throw new Error("the TOOL_CALL_LOG binding is missing");
  return ns.get(ns.idFromName("tool-calls"));
}

/**
 * Copies the rows not yet copied to `bucket` (L6), then deletes copied rows older than `keepDays` (L7). Run it from the
 * Worker's cron (./cron's `runJobs`); each run copies up to 20 batches of 1000 rows and the next run goes on. Throws
 * when a write fails, so the job is recorded as failed and nothing is marked copied that is not.
 * @param {Partial<import("./audit-log.d.mts").AuditEnv>} env
 * @param {{ put(key: string, value: string, options?: unknown): Promise<unknown> }} bucket
 * @param {{ prefix?: string, keepDays?: number }} [options]
 * @returns {Promise<{ exported: number, objects: string[], pruned: number }>}
 */
export async function exportAuditLog(env, bucket, { prefix = "tool-calls/", keepDays = AUDIT_KEEP_DAYS } = {}) {
  const stub = logStub(env);
  const call = async (/** @type {string} */ path, /** @type {unknown} */ body) => {
    const response = await stub.fetch(`https://tool-call-log.invalid${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`the tool-call log answered ${response.status} to ${path}`);
    return /** @type {any} */ (await response.json());
  };
  const pad = (/** @type {unknown} */ seq) => String(seq).padStart(12, "0");
  /** @type {string[]} */
  const objects = [];
  let exported = 0;
  let pruned = 0;
  for (let batch = 0; batch < EXPORT_BATCHES; batch++) {
    const { previous, rows } = await call("/export", { limit: EXPORT_BATCH });
    const last = rows.at(-1);
    if (!last) break;
    const key = `${prefix}${pad(rows[0].seq)}-${pad(last.seq)}.json`;
    await bucket.put(key, JSON.stringify({ previous, rows }), { httpMetadata: { contentType: "application/json" } });
    objects.push(key);
    exported += rows.length;
    pruned += (await call("/exported", { seq: last.seq, hash: last.hash ?? null, keepDays })).pruned;
    if (rows.length < EXPORT_BATCH) break;
  }
  if (objects.length === 0) pruned += (await call("/exported", { seq: 0, hash: null, keepDays })).pruned;
  return { exported, objects, pruned };
}

/**
 * The tool-call log's /health check (L8, ./health's `healthResponse({ checks })`), level warn and alert: fails when a
 * call's `finished` row is 15 minutes late, when calls in the last hour pass `spikePerHour`, or when rows have waited
 * more than two days for a copy. The detail gives counts only.
 * @param {Partial<import("./audit-log.d.mts").AuditEnv>} env
 * @param {{ spikePerHour?: number }} [options]
 * @returns {import("./health.d.mts").HealthCheck}
 */
export function auditLogCheck(env, { spikePerHour = 600 } = {}) {
  return {
    name: "tool-call-log",
    level: "warn",
    alert: true,
    run: async () => {
      const response = await logStub(env).fetch("https://tool-call-log.invalid/stats");
      if (!response.ok) return { ok: false, detail: `the log answered ${response.status}` };
      const s = /** @type {{ lastHour: number, orphans: number, unexported: number, oldestUnexported: string | null }} */ (await response.json());
      const late = s.oldestUnexported !== null && Date.now() - Date.parse(s.oldestUnexported) > EXPORT_LATE_DAYS * 86_400_000;
      const wrong = [
        s.orphans > 0 ? `${s.orphans} call(s) with no finished row after ${ORPHAN_MINUTES} minutes` : "",
        s.lastHour > spikePerHour ? `${s.lastHour} calls in the last hour` : "",
        late ? `${s.unexported} row(s) not copied for over ${EXPORT_LATE_DAYS} days` : "",
      ].filter(Boolean);
      return wrong.length ? { ok: false, detail: wrong.join("; ") } : true;
    },
  };
}

/**
 * Appends one row. Throws when the binding is missing or the write fails, so the caller decides: a failed `started`
 * refuses the call, a failed `finished` is reported to the Worker log.
 * @param {Partial<import("./audit-log.d.mts").AuditEnv>} env
 * @param {import("./audit-log.d.mts").AuditRow} row
 */
export async function appendAudit(env, row) {
  const response = await logStub(env).fetch("https://tool-call-log.invalid/append", {
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
