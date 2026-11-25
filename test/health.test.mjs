import assert from "node:assert/strict";
import { test } from "node:test";

import {
  aiOutcomeCheck,
  databaseDown,
  healthResponse,
  recordAiOutcome,
  siteHealthResponse,
} from "../health.mjs";

test("a stale backup warns at 200 with ok true; a database that throws fails at 503; the backup read is kept in the cache for the TTL", async () => {
  let reads = 0;
  /** @type {Map<string, Response>} */
  const kept = new Map();
  const cache = {
    match: async (/** @type {string} */ k) => kept.get(k)?.clone(),
    put: async (/** @type {string} */ k, /** @type {Response} */ r) => void kept.set(k, r),
  };
  const backup = async () => (
    reads++,
    { last_ok: "2026-10-24T00:00:00Z", warning: "backup older than 26 hours" }
  );
  const at = (/** @type {number} */ ms) => new Date(Date.UTC(2026, 9, 25) + ms);
  const first = await healthResponse({
    ping: async () => 1,
    backup,
    sha: "abc123",
    now: at(0),
    cache,
  });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("Content-Type"), "application/health+json; charset=utf-8");
  assert.deepEqual(
    { ...(await first.json()), backup: undefined },
    {
      status: "warn",
      ok: true,
      db: "up",
      backup: undefined,
      sha: "abc123",
      time: at(0).toISOString(),
      checks: [
        { name: "db", status: "pass" },
        { name: "backup", status: "warn", detail: "backup older than 26 hours" },
      ],
    },
  );
  const down = await healthResponse({
    ping: async () => {
      throw new Error("D1");
    },
    backup,
    sha: "abc123",
    now: at(60_000),
    cache,
  });
  assert.equal(down.status, 503);
  assert.deepEqual((({ status, ok }) => ({ status, ok }))(await down.json()), {
    status: "fail",
    ok: false,
  });
  assert.equal(reads, 1);
  await healthResponse({ ping: async () => 1, backup, sha: "def456", now: at(2 * 60_000), cache });
  assert.equal(reads, 2);
  await healthResponse({
    ping: async () => 1,
    backup,
    sha: "abc123",
    now: at(5 * 60_000),
    backupTtlMs: 0,
    cache,
  });
  assert.equal(reads, 3);
});

test("a check that hangs fails at the timeout; a warn check never makes it 503, an alert included; error text is scrubbed", async () => {
  const response = await healthResponse({
    checks: [
      { name: "kv", level: "warn", run: () => new Promise(() => {}) },
      { name: "drift", level: "warn", run: async () => ({ ok: false, detail: "2 posts differ" }) },
      { name: "auth-spike", level: "warn", alert: true, run: async () => false },
      { name: "stalled-spike", level: "warn", alert: true, run: () => new Promise(() => {}) },
    ],
    checkTimeoutMs: 20,
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.checks, [
    { name: "kv", status: "warn", detail: "timed out after 20 ms" },
    { name: "drift", status: "warn", detail: "2 posts differ" },
    { name: "auth-spike", status: "warn", alert: true },
    { name: "stalled-spike", status: "warn", detail: "could not run: timed out after 20 ms" },
  ]);
  assert.deepEqual([body.ok, body.alerts], [true, ["auth-spike"]]);
  const failed = await healthResponse({
    checks: [
      {
        name: "r2",
        run: async () => {
          throw new Error("no access for a@example.com");
        },
      },
    ],
  });
  assert.equal(failed.status, 503);
  assert.deepEqual((await failed.json()).checks, [
    { name: "r2", status: "fail", detail: "no access for [email]" },
  ]);
});

test("a database-down error becomes a 503 the error page reads; a wrong query stays itself", () => {
  const down = new Error("D1_ERROR", {
    cause: new Error("D1 DB storage operation exceeded timeout which caused object to be reset."),
  });
  const response = databaseDown(down);
  assert.ok(response instanceof Response);
  assert.equal(response.status, 503);
  assert.equal(response.statusText, "Database unavailable");
  const importing = new Error("Failed query: select 1", {
    cause: new Error("D1_ERROR: Currently processing a long-running import."),
  });
  assert.equal(/** @type {Response} */ (databaseDown(importing)).status, 503);
  const wrong = new Error("D1_ERROR: no such table: posts");
  assert.equal(databaseDown(wrong), wrong);
});

const memoryKv = () => {
  const map = new Map();
  return {
    get: async (k) => map.get(k) ?? null,
    put: async (k, v) => void map.set(k, v),
    delete: async (k) => void map.delete(k),
  };
};

test("aiOutcomeCheck fails after a failed call and passes again once a call succeeds", async () => {
  const kv = memoryKv();
  const check = aiOutcomeCheck("ask", kv);
  assert.equal(check.name, "ai-ask");
  assert.equal(await check.run(), true);
  await recordAiOutcome(kv, "ask", { ok: false, kind: "spend_limit" });
  const failed = await check.run();
  assert.equal(failed.ok, false);
  assert.match(failed.detail, /spend_limit/);
  await recordAiOutcome(kv, "ask", { ok: false, kind: "aborted" });
  assert.match((await check.run()).detail, /spend_limit/);
  await recordAiOutcome(kv, "ask", { ok: true });
  assert.equal(await check.run(), true);
  await recordAiOutcome(kv, "ask", { ok: false, kind: "aborted" });
  assert.equal(await check.run(), true);
});

test("recordAiOutcome never throws when the KV does", async () => {
  const broken = {
    get: async () => {
      throw new Error("down");
    },
  };
  await recordAiOutcome(broken, "ask", { ok: true }, () => {});
});

test("a fail check that timed out or threw logs a warning, one that measured a failure an error", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const error = t.mock.method(console, "error", () => {});
  const run = (name, check) =>
    healthResponse({ checks: [{ name, run: check }], checkTimeoutMs: 20 });
  assert.equal((await run("db", () => new Promise(() => {}))).status, 503);
  assert.match(warn.mock.calls[0].arguments[0], /health_check_unavailable/);
  assert.equal(error.mock.callCount(), 0);
  await run("r2", async () => ({ ok: false, detail: "missing" }));
  assert.match(error.mock.calls[0].arguments[0], /health_check_failed/);
});

test("siteHealthResponse reads the cron jobs from a function, so a job the site switched off is left out", async () => {
  const db = {
    prepare: () => ({
      first: async () => ({}),
      bind: () => ({ all: async () => ({ results: [] }) }),
    }),
  };
  const body = async (jobs) =>
    (await siteHealthResponse({ DB: db }, { jobs, checks: [] }).then((r) => r.json())).checks.find(
      (c) => c.name === "cron",
    );
  const job = { name: "backup", everyMinutes: 60 };
  assert.equal((await body(async () => [])).status, "pass");
  const missing = await body(() => [job]);
  assert.equal(missing.status, "warn");
  assert.equal(missing.detail, "backup never ran");
});
