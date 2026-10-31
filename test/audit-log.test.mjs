// The tool-call log over a real SQLite standing in for the Durable Object's: an older table gains the new columns in
// place, appends sent at once still form one chain, an edited row breaks it, and a long argument is kept as a digest.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { ToolCallLog, loggedArgs, verifyAuditChain } from "../audit-log.mjs";

function storage() {
  const db = new DatabaseSync(":memory:");
  // Like the Durable Object's, exec runs the statement at once and hands back its rows.
  const sql = {
    exec: (/** @type {string} */ query, /** @type {any[]} */ ...params) => {
      const rows = db.prepare(query).all(...params);
      return { toArray: () => rows };
    },
  };
  return { db, state: /** @type {any} */ ({ storage: { sql } }) };
}

const append = (/** @type {ToolCallLog} */ log, /** @type {Record<string, unknown>} */ row) =>
  log.fetch(new Request("https://tool-call-log.invalid/append", { method: "POST", body: JSON.stringify(row) }));

test("PLANT: concurrent appends form one chain over a migrated table, and an edited row breaks it", async () => {
  const { db, state } = storage();
  db.exec(
    "CREATE TABLE calls (seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, call_id TEXT NOT NULL, " +
      "phase TEXT NOT NULL, caller TEXT NOT NULL, tool TEXT NOT NULL, args TEXT NOT NULL, result TEXT)",
  );
  db.exec("INSERT INTO calls (at, call_id, phase, caller, tool, args) VALUES ('2026-10-01T00:00:00.000Z', 'old', 'started', 'access:a@example.com', 't', '{}')");
  const log = new ToolCallLog(state);
  new ToolCallLog(state); // a second start finds the columns already there

  const row = { caller: "access:a@example.com", tool: "sample_tool", server: { name: "sample-mcp", version: "1.0.0" }, clientId: "https://client.example.com/meta" };
  const answers = await Promise.all(
    ["started", "finished", "refused"].map((phase, i) => append(log, { ...row, callId: `c${i}`, phase, args: { note: "line one\r\nline two" } })),
  );
  assert.deepEqual(answers.map((r) => r.status), [204, 204, 204]);

  const rows = db.prepare("SELECT * FROM calls ORDER BY seq").all();
  assert.equal(rows.length, 4);
  assert.equal(rows[0].hash, null);
  assert.equal(rows[1].server, "sample-mcp");
  assert.deepEqual(JSON.parse(String(rows[1].args)), { note: "line one\r\nline two" });
  assert.deepEqual(await verifyAuditChain(rows), { ok: true, hashed: 3 });

  db.exec("UPDATE calls SET args = '{}' WHERE seq = 3");
  assert.deepEqual(await verifyAuditChain(db.prepare("SELECT * FROM calls ORDER BY seq").all()), { ok: false, seq: 3 });
  assert.equal((await log.fetch(new Request("https://tool-call-log.invalid/", { method: "GET" }))).status, 405);
});

test("PLANT: with the key bound, an editor who recomputes the chain without the secret is caught", async () => {
  const { db, state } = storage();
  const log = new ToolCallLog(state, { AUDIT_CHAIN_KEY: "sample-secret" });
  for (const callId of ["k1", "k2"]) await append(log, { caller: "access:a@example.com", tool: "sample_tool", phase: "started", callId, args: {} });
  const rows = () => db.prepare("SELECT * FROM calls ORDER BY seq").all();
  assert.deepEqual(await verifyAuditChain(rows(), "sample-secret"), { ok: true, hashed: 2 });

  // Rewrite row 1 and recompute every hash the only way an editor without the secret can: plain SHA-256.
  db.exec("UPDATE calls SET args = '{\"forged\":true}' WHERE seq = 1");
  let previous = "";
  for (const r of rows()) {
    const fields = ["at", "call_id", "phase", "caller", "tool", "args", "result", "server", "version", "client_id", "correlation_id"];
    previous = createHash("sha256").update(`${previous}\n${JSON.stringify(fields.map((f) => r[f] ?? null))}`).digest("hex");
    db.prepare("UPDATE calls SET hash = ? WHERE seq = ?").run(previous, r.seq);
  }
  assert.deepEqual(await verifyAuditChain(rows()), { ok: true, hashed: 2 }); // what plain SHA-256 cannot catch
  assert.deepEqual(await verifyAuditChain(rows(), "sample-secret"), { ok: false, seq: 1 });
});

test("loggedArgs keeps a string of 200 characters and stores a longer one as its length and digest prefix", async () => {
  const long = "x".repeat(201);
  assert.deepEqual(await loggedArgs({ short: "y".repeat(200), long, n: 3 }), {
    short: "y".repeat(200),
    long: { chars: 201, sha256: createHash("sha256").update(long).digest("hex").slice(0, 16) },
    n: 3,
  });
});
