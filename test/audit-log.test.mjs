// The tool-call log over a real SQLite standing in for the Durable Object's: an older table gains the new columns in
// place and is anchored by its first key, appends sent at once still form one signed chain, a new key re-anchors it,
// an edited or stripped row breaks it, and a long argument is kept as a digest.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  ToolCallLog,
  auditChainKey,
  auditLogCheck,
  exportAuditLog,
  loggedArgs,
  loggedResult,
  verifyAuditChain,
} from "../audit-log.mjs";

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
  log.fetch(
    new Request("https://tool-call-log.invalid/append", {
      method: "POST",
      body: JSON.stringify(row),
    }),
  );

const KEY_A = "sample-chain-key-a-0123456789abcdefghij";
const KEY_B = "sample-chain-key-b-0123456789abcdefghij";
const all = (/** @type {DatabaseSync} */ db) =>
  db.prepare("SELECT * FROM calls ORDER BY seq").all();
const plainHash = (/** @type {string} */ previous, /** @type {Record<string, unknown>} */ r) =>
  createHash("sha256")
    .update(`${previous}\n${JSON.stringify(HASHED.map((f) => r[f] ?? null))}`)
    .digest("hex");
const HASHED = [
  "at",
  "call_id",
  "phase",
  "caller",
  "tool",
  "args",
  "result",
  "server",
  "version",
  "client_id",
  "correlation_id",
];

test("PLANT: an old plain chain is anchored by the first key, appends sent at once form one signed chain, and an edit or a strip is caught", async () => {
  const { db, state } = storage();
  db.exec(
    "CREATE TABLE calls (seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, call_id TEXT NOT NULL, " +
      "phase TEXT NOT NULL, caller TEXT NOT NULL, tool TEXT NOT NULL, args TEXT NOT NULL, result TEXT, hash TEXT)",
  );
  // A row from before the hash column, then one plain SHA-256 row as 0.83 wrote it.
  db.exec(
    "INSERT INTO calls (at, call_id, phase, caller, tool, args) VALUES ('2026-10-01T00:00:00.000Z', 'old', 'started', 'access:a@example.com', 't', '{}')",
  );
  const plain = {
    at: "2026-10-02T00:00:00.000Z",
    call_id: "p1",
    phase: "started",
    caller: "access:a@example.com",
    tool: "t",
    args: "{}",
  };
  db.prepare(
    "INSERT INTO calls (at, call_id, phase, caller, tool, args, hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(...Object.values(plain), plainHash("", plain));

  const log = new ToolCallLog(state, { AUDIT_SIGNING_KEY: KEY_A });
  const row = {
    caller: "access:a@example.com",
    tool: "sample_tool",
    server: { name: "sample-mcp", version: "1.0.0" },
    clientId: "https://client.example.com/meta",
  };
  const answers = await Promise.all(
    ["started", "finished", "refused"].map((phase, i) =>
      append(log, { ...row, callId: `c${i}`, phase, args: { note: "line one\r\nline two" } }),
    ),
  );
  assert.deepEqual(
    answers.map((r) => r.status),
    [204, 204, 204],
  );
  const key = await auditChainKey(KEY_A);

  const rows = all(db);
  assert.equal(rows.length, 6);
  assert.equal(rows[2].phase, "chain-key");
  assert.deepEqual(JSON.parse(String(rows[2].args)), {
    from: null,
    fromPublicKey: null,
    to: key.id,
    publicKey: key.publicKey,
  });
  assert.deepEqual(JSON.parse(String(rows[3].args)), { note: "line one\r\nline two" });
  assert.deepEqual(await verifyAuditChain(rows, { keys: [key.publicKey] }), {
    ok: true,
    hashed: 5,
    signed: 4,
  });

  db.exec("UPDATE calls SET args = '{}' WHERE seq = 4");
  assert.deepEqual(await verifyAuditChain(all(db), { keys: [key.publicKey] }), {
    ok: false,
    seq: 4,
    reason: "hash",
  });

  // An editor without the secret rewrites a row, strips the signatures and recomputes every hash as plain SHA-256.
  let previous = "";
  for (const r of all(db).filter((r) => r.hash !== null)) {
    db.prepare("UPDATE calls SET key_id = NULL, sig = NULL, hash = ? WHERE seq = ?").run(
      (previous = plainHash(previous, r)),
      r.seq,
    );
  }
  assert.deepEqual(await verifyAuditChain(all(db)), { ok: true, hashed: 5, signed: 0 }); // what hashes alone cannot catch
  assert.deepEqual(await verifyAuditChain(all(db), { keys: [key.publicKey] }), {
    ok: false,
    seq: 2,
    reason: "unsigned",
  });
  assert.equal(
    (await log.fetch(new Request("https://tool-call-log.invalid/", { method: "GET" }))).status,
    405,
  );
});

test("PLANT: a new key re-anchors the chain, which checks with the new key alone; a forged anchor is not trusted", async () => {
  const { db, state } = storage();
  const first = new ToolCallLog(state, { AUDIT_SIGNING_KEY: KEY_A });
  for (const callId of ["k1", "k2"])
    await append(first, { caller: "agent:sample", tool: "t", phase: "started", callId, args: {} });
  const [a, b] = await Promise.all([auditChainKey(KEY_A), auditChainKey(KEY_B)]);

  // The secret is replaced and the Worker starts again: the chain goes on, vouched for by the new key.
  const second = new ToolCallLog(state, { AUDIT_SIGNING_KEY: KEY_B });
  await append(second, {
    caller: "agent:sample",
    tool: "t",
    phase: "started",
    callId: "k3",
    args: {},
  });
  const rows = all(db);
  assert.deepEqual(JSON.parse(String(rows[3].args)), {
    from: a.id,
    fromPublicKey: a.publicKey,
    to: b.id,
    publicKey: b.publicKey,
  });
  assert.deepEqual(await verifyAuditChain(rows, { keys: [b.publicKey] }), {
    ok: true,
    hashed: 5,
    signed: 5,
  });
  assert.deepEqual(
    await verifyAuditChain(rows.slice(3), { keys: [b.publicKey], previous: String(rows[2].hash) }),
    { ok: true, hashed: 2, signed: 2 },
  );

  // An anchor that names a key nobody trusts vouches for nothing.
  assert.deepEqual(await verifyAuditChain(rows, { keys: [a.publicKey] }), {
    ok: false,
    seq: 4,
    reason: "unknown key",
  });
  db.prepare("UPDATE calls SET sig = ? WHERE seq = 4").run(rows[0].sig);
  assert.deepEqual(await verifyAuditChain(all(db), { keys: [b.publicKey] }), {
    ok: false,
    seq: 1,
    reason: "unknown key",
  });
});

test("PLANT: without AUDIT_SIGNING_KEY nothing is written and the check says why", async () => {
  const { db, state } = storage();
  const log = new ToolCallLog(state, {});
  await assert.rejects(
    append(log, { caller: "agent:sample", tool: "t", phase: "started", callId: "n1", args: {} }),
    /AUDIT_SIGNING_KEY is not bound/,
  );
  assert.equal(all(db).length, 0);
  const env = {
    TOOL_CALL_LOG: {
      idFromName: () => "id",
      get: () => ({ fetch: (url, init) => log.fetch(new Request(url, init)) }),
    },
  };
  assert.match(String((await auditLogCheck(env).run()).detail), /AUDIT_SIGNING_KEY is not bound/);
});

test("PLANT: the copy lands in R2 checked and checks on its own; only copied rows past retention go; a late finished row alerts", async () => {
  const { db, state } = storage();
  const log = new ToolCallLog(state, { AUDIT_SIGNING_KEY: KEY_A });
  const env = {
    AUDIT_SIGNING_KEY: KEY_A,
    TOOL_CALL_LOG: {
      idFromName: () => "id",
      get: () => ({ fetch: (url, init) => log.fetch(new Request(url, init)) }),
    },
  };
  for (const callId of ["e1", "e2", "e3"])
    await append(log, { caller: "agent:sample", tool: "t", phase: "started", callId, args: {} });
  await append(log, {
    caller: "agent:sample",
    tool: "t",
    phase: "finished",
    callId: "e1",
    args: {},
  });
  // e2 started an hour ago and never finished; e1's and e3's rows and the anchor are long past retention.
  db.prepare("UPDATE calls SET at = ? WHERE call_id = 'e2'").run(
    new Date(Date.now() - 3_600_000).toISOString(),
  );
  db.exec(
    "UPDATE calls SET at = '2020-01-01T00:00:00.000Z' WHERE call_id IN ('e1', 'e3') OR phase = 'chain-key'",
  );
  const check = auditLogCheck(env);
  assert.equal(
    (await check.run()).detail,
    "1 call(s) with no finished row after 15 minutes; 5 row(s) not copied for over 2 days",
  );

  // Rows never copied are never deleted, however old.
  const mark = await log.fetch(
    new Request("https://tool-call-log.invalid/exported", {
      method: "POST",
      body: JSON.stringify({ seq: 0, hash: null }),
    }),
  );
  assert.equal((await mark.json()).pruned, 0);

  // The dates were edited after the rows were hashed, so the copy's check fails, the copy is still made, and the check alerts.
  const bucket = new Map();
  const r2 = { put: async (key, value) => void bucket.set(key, JSON.parse(value)) };
  const first = await exportAuditLog(env, r2, { keepDays: 30 });
  assert.deepEqual(first.objects, ["tool-calls/000000000001-000000000005.json"]);
  assert.deepEqual(first.verified, { ok: false, seq: 1, reason: "hash" });
  // The anchor, e1's started row and e3 go; e2 is recent, and e1's finished row is the newest, which the next append chains to.
  assert.equal(first.pruned, 3);
  assert.deepEqual(
    db
      .prepare("SELECT seq FROM calls")
      .all()
      .map((r) => r.seq),
    [3, 5],
  );
  assert.match(
    String((await check.run()).detail),
    /chain check of the last copy failed at row 1 \(hash\)/,
  );

  // The next copy chains on from the last, passes, and checks on its own with the keys it carries.
  await append(log, {
    caller: "agent:sample",
    tool: "t",
    phase: "refused",
    callId: "e4",
    args: {},
  });
  assert.equal((await exportAuditLog(env, r2)).verified?.ok, true);
  const copy = bucket.get("tool-calls/000000000006-000000000006.json");
  assert.deepEqual(copy.verified, { ok: true, hashed: 1, signed: 1 });
  assert.deepEqual(
    await verifyAuditChain(copy.rows, { keys: copy.keys, previous: copy.previous }),
    { ok: true, hashed: 1, signed: 1 },
  );
  assert.deepEqual(await verifyAuditChain(copy.rows, { keys: copy.keys }), {
    ok: false,
    seq: 6,
    reason: "hash",
  });
  assert.equal((await check.run()).detail, "1 call(s) with no finished row after 15 minutes");
});

test("loggedArgs and loggedResult cut credentials out and digest what is long, nested or not", async () => {
  const long = "x".repeat(201);
  const key = "sk_live_abcdefghijklmnop";
  const big = { rows: Array.from({ length: 200 }, (_, i) => `row-${i}`) };
  const logged = await loggedArgs({
    short: "y".repeat(200),
    long,
    n: 3,
    auth: `Bearer ${"a".repeat(24)}`,
    nested: { note: `token ${key}`, ok: true },
    big,
  });
  assert.deepEqual(logged, {
    short: "y".repeat(200),
    long: { chars: 201, sha256: createHash("sha256").update(long).digest("hex").slice(0, 16) },
    n: 3,
    auth: "[key]",
    nested: { note: "token [key]", ok: true },
    big: {
      chars: JSON.stringify(big).length,
      sha256: createHash("sha256").update(JSON.stringify(big)).digest("hex").slice(0, 16),
    },
  });
  assert.deepEqual(loggedResult({ content: [{ text: `made ${key}` }, { text: "done" }] }), {
    isError: false,
    text: "made [key]\ndone",
  });
});
