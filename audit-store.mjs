/** The tool-call log's Durable Object: the append-only rows, their copy mark and retention (see audit-log.mjs). */

import { ANCHOR, HASHED, auditChainKey, rowHash } from "./audit-chain.mjs";

export const AUDIT_KEEP_DAYS = 90;
export const EXPORT_BATCH = 1000;
export const ORPHAN_MINUTES = 15;
const FIELD_CHARS = 200;
const RECENT_PAGE = 50;
const RECENT_MAX = 100;

const ADDED = [
  "server",
  "version",
  "client_id",
  "correlation_id",
  "client_name",
  "hash",
  "key_id",
  "sig",
];

/** The Durable Object class a Worker exports (as ToolCallLog) and binds as TOOL_CALL_LOG. */
export class ToolCallLog {
  /**
   * @param {DurableObjectState} state
   * @param {Partial<import("./audit-log.mjs").AuditEnv>} [env]
   */
  constructor(state, env) {
    this.sql = state.storage.sql;
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS calls (" +
        "seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, call_id TEXT NOT NULL, " +
        "phase TEXT NOT NULL, caller TEXT NOT NULL, tool TEXT NOT NULL, args TEXT NOT NULL, result TEXT)",
    );
    const have = new Set(
      this.sql
        .exec("PRAGMA table_info(calls)")
        .toArray()
        .map((column) => column.name),
    );
    for (const name of ADDED)
      if (!have.has(name)) this.sql.exec(`ALTER TABLE calls ADD COLUMN ${name} TEXT`);
    // The orphan count looks each started call's finished row up by call_id; without this it scans the table per row.
    this.sql.exec("CREATE INDEX IF NOT EXISTS calls_call_id ON calls (call_id, phase)");
    // How far the copy has got: the last copied row's seq and hash, and when; `verify` is the last copy's check.
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS export_state (id INTEGER PRIMARY KEY CHECK (id = 1), seq INTEGER NOT NULL, hash TEXT, at TEXT NOT NULL)",
    );
    if (
      !this.sql
        .exec("PRAGMA table_info(export_state)")
        .toArray()
        .some((column) => column.name === "verify")
    ) {
      this.sql.exec("ALTER TABLE export_state ADD COLUMN verify TEXT");
    }
    // Each key that has signed here, so a rotation's anchor can name the key before it after that key's anchor is pruned.
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS chain_keys (id TEXT PRIMARY KEY, public_key TEXT NOT NULL, first_at TEXT NOT NULL)",
    );
    // The key is derived and anchored before any row is written; appends wait for it, and each reads the hash the one
    // before it wrote, so they run one at a time.
    this.key = auditChainKey(env?.AUDIT_SIGNING_KEY);
    this.key.catch(() => {}); // a missing key is answered on each append and in stats
    /** @type {Promise<unknown>} */
    this.tail = this.key.then((key) => this.anchor(key));
    this.tail.catch(() => {});
  }

  /** @param {Request} request */
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/stats") return Response.json(await this.stats());
    if (request.method === "GET" && path === "/recent") {
      const query = new URL(request.url).searchParams;
      return Response.json({
        rows: this.recent(
          Number(query.get("before")) || 0,
          Number(query.get("limit")) || RECENT_PAGE,
        ),
      });
    }
    if (request.method === "GET" && path === "/anchors") {
      return Response.json({
        rows: this.sql.exec("SELECT * FROM calls WHERE phase = ? ORDER BY seq", ANCHOR).toArray(),
      });
    }
    if (request.method !== "POST") return new Response("append only", { status: 405 });
    if (path === "/export")
      return Response.json(this.unexported(Number((await request.json()).limit) || EXPORT_BATCH));
    if (path === "/exported") {
      const { seq, hash, keepDays, verify } =
        /** @type {{ seq: number, hash: string | null, keepDays?: number, verify?: unknown }} */ (
          await request.json()
        );
      return Response.json(this.markExported(seq, hash, keepDays ?? AUDIT_KEEP_DAYS, verify));
    }
    const row = /** @type {import("./audit-log.mjs").AuditRow} */ (await request.json());
    const append = this.tail.then(() => this.key).then((key) => this.append(row, key));
    this.tail = append.catch(() => {});
    await append;
    return new Response(null, { status: 204 });
  }

  /**
   * Writes the `chain-key` row when the key that signed the newest row is not this one (or no row is signed yet).
   * @param {import("./audit-log.mjs").ChainKey} key
   */
  async anchor(key) {
    const newest = this.sql
      .exec("SELECT key_id FROM calls WHERE hash IS NOT NULL ORDER BY seq DESC LIMIT 1")
      .toArray()[0];
    const from = /** @type {string | null} */ (newest?.key_id ?? null);
    if (from === key.id) return;
    const known =
      from === null
        ? undefined
        : this.sql.exec("SELECT public_key FROM chain_keys WHERE id = ?", from).toArray()[0];
    const fromPublicKey = /** @type {string | null} */ (known?.public_key ?? null);
    this.sql.exec(
      "INSERT OR IGNORE INTO chain_keys (id, public_key, first_at) VALUES (?, ?, ?)",
      key.id,
      key.publicKey,
      new Date().toISOString(),
    );
    await this.append(
      {
        callId: crypto.randomUUID(),
        phase: ANCHOR,
        caller: "site-runtime",
        args: { from, fromPublicKey, to: key.id, publicKey: key.publicKey },
      },
      key,
    );
  }

  /**
   * The rows after the last copied one, oldest first, and the hash before them.
   * @param {number} limit
   */
  unexported(limit) {
    const mark = this.sql.exec("SELECT seq, hash FROM export_state WHERE id = 1").toArray()[0];
    const rows = this.sql
      .exec(
        "SELECT * FROM calls WHERE seq > ? ORDER BY seq LIMIT ?",
        Number(mark?.seq ?? 0),
        Math.min(Math.max(1, limit), EXPORT_BATCH),
      )
      .toArray();
    return { previous: mark?.hash ?? null, rows };
  }

  /**
   * Marks the rows through `seq` copied with the copy's check, then deletes the copied rows older than `keepDays`,
   * except the newest row, which the next append chains to. Never moves the mark back.
   * @param {number} seq
   * @param {string | null} hash
   * @param {number} keepDays
   * @param {unknown} verify
   */
  markExported(seq, hash, keepDays, verify) {
    const at = new Date();
    const mark = Number(
      this.sql.exec("SELECT seq FROM export_state WHERE id = 1").toArray()[0]?.seq ?? 0,
    );
    if (Number.isInteger(seq) && seq > mark) {
      this.sql.exec(
        "INSERT INTO export_state (id, seq, hash, at, verify) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET seq = excluded.seq, hash = excluded.hash, at = excluded.at, verify = excluded.verify",
        seq,
        hash,
        at.toISOString(),
        verify === undefined ? null : JSON.stringify(verify),
      );
    }
    const through = Math.max(mark, Number.isInteger(seq) ? seq : 0);
    const cutoff = new Date(at.getTime() - Math.max(1, keepDays) * 86_400_000).toISOString();
    // The newest row stays whatever its age: the next append chains to it.
    const pruned = this.sql
      .exec(
        "DELETE FROM calls WHERE seq <= ? AND at < ? AND seq < (SELECT max(seq) FROM calls) RETURNING seq",
        through,
        cutoff,
      )
      .toArray().length;
    return { through, pruned };
  }

  /**
   * Up to `limit` rows (at most 100) before the row `before` (0: the newest), newest first: what an owner page shows.
   * @param {number} before
   * @param {number} limit
   */
  recent(before, limit) {
    const n = Math.min(Math.max(1, Math.floor(limit)), RECENT_MAX);
    const columns =
      "seq, at, call_id, phase, caller, tool, args, result, server, version, client_id, client_name, correlation_id";
    return before > 0
      ? this.sql
          .exec(
            `SELECT ${columns} FROM calls WHERE seq < ? ORDER BY seq DESC LIMIT ?`,
            Math.floor(before),
            n,
          )
          .toArray()
      : this.sql.exec(`SELECT ${columns} FROM calls ORDER BY seq DESC LIMIT ?`, n).toArray();
  }

  /**
   * What the alert reads: calls in the last hour, `started` rows with no `finished` after ORPHAN_MINUTES, the rows
   * waiting for a copy with the oldest one's time, the last copy's chain check, and why the log cannot sign, if it cannot.
   */
  async stats() {
    const now = Date.now();
    const iso = (/** @type {number} */ ms) => new Date(now - ms).toISOString();
    const one = (/** @type {string} */ query, /** @type {unknown[]} */ ...params) =>
      this.sql.exec(query, ...params).toArray()[0] ?? {};
    const state = one("SELECT seq, verify FROM export_state WHERE id = 1");
    const mark = Number(state.seq ?? 0);
    const waiting = one("SELECT count(*) AS n, min(at) AS oldest FROM calls WHERE seq > ?", mark);
    const keyError = await this.key.then(
      () => null,
      (/** @type {unknown} */ cause) => String(/** @type {Error} */ (cause).message ?? cause),
    );
    return {
      lastHour: Number(
        one("SELECT count(*) AS n FROM calls WHERE phase = 'started' AND at >= ?", iso(3_600_000))
          .n ?? 0,
      ),
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
      verify: state.verify ? JSON.parse(String(state.verify)) : null,
      keyError,
    };
  }

  /**
   * @param {import("./audit-log.mjs").AuditRow | { callId: string, phase: string, caller: string, args: Record<string, unknown> }} row
   * @param {import("./audit-log.mjs").ChainKey} key
   */
  async append(row, key) {
    const field = (/** @type {unknown} */ value) =>
      value === undefined || value === null ? null : String(value).slice(0, FIELD_CHARS);
    const full = /** @type {import("./audit-log.mjs").AuditRow} */ (row);
    /** @type {Record<string, string | null>} */
    const values = {
      at: new Date().toISOString(),
      call_id: String(full.callId),
      phase: String(full.phase),
      caller: String(full.caller).slice(0, FIELD_CHARS),
      tool: String(full.tool ?? "").slice(0, FIELD_CHARS),
      args: JSON.stringify(full.args ?? {}),
      result: full.result === undefined ? null : JSON.stringify(full.result),
      server: field(full.server?.name),
      version: field(full.server?.version),
      client_id: field(full.clientId),
      correlation_id: field(full.correlationId),
      client_name: field(full.clientName),
      key_id: key.id,
    };
    const last = this.sql.exec("SELECT hash FROM calls ORDER BY seq DESC LIMIT 1").toArray()[0];
    const hash = await rowHash(/** @type {string | null} */ (last?.hash ?? null), values);
    const columns = [...HASHED, "client_name", "key_id"];
    this.sql.exec(
      `INSERT INTO calls (${columns.join(", ")}, hash, sig) VALUES (${columns.map(() => "?").join(", ")}, ?, ?)`,
      ...columns.map((name) => values[name]),
      hash,
      await key.sign(hash),
    );
  }
}
