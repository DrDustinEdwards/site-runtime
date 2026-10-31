import assert from "node:assert/strict";
import { test } from "node:test";

import { healthResponse } from "../health.mjs";

test("a stale backup warns at 200 with ok true; a database that throws fails at 503; the backup read is held for the TTL", async () => {
  let reads = 0;
  const backup = async () => (reads++, { last_ok: "2026-10-24T00:00:00Z", warning: "backup older than 26 hours" });
  const at = (/** @type {number} */ ms) => new Date(Date.UTC(2026, 9, 25) + ms);
  const first = await healthResponse({ ping: async () => 1, backup, sha: "abc123", now: at(0) });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("Content-Type"), "application/health+json; charset=utf-8");
  assert.deepEqual({ ...(await first.json()), backup: undefined }, {
    status: "warn",
    ok: true,
    db: "up",
    backup: undefined,
    sha: "abc123",
    time: at(0).toISOString(),
    checks: [{ name: "db", status: "pass" }, { name: "backup", status: "warn", detail: "backup older than 26 hours" }],
  });
  const down = await healthResponse({ ping: async () => { throw new Error("D1"); }, backup, now: at(60_000) });
  assert.equal(down.status, 503);
  assert.deepEqual((({ status, ok }) => ({ status, ok }))(await down.json()), { status: "fail", ok: false });
  assert.equal(reads, 1);
  await healthResponse({ ping: async () => 1, backup, now: at(5 * 60_000) });
  assert.equal(reads, 2);
});

test("a check that hangs fails at the timeout; a warn check never makes it 503; error text is scrubbed", async () => {
  const response = await healthResponse({
    checks: [
      { name: "kv", level: "warn", run: () => new Promise(() => {}) },
      { name: "drift", level: "warn", run: async () => ({ ok: false, detail: "2 posts differ" }) },
    ],
    checkTimeoutMs: 20,
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).checks, [
    { name: "kv", status: "warn", detail: "timed out after 20 ms" },
    { name: "drift", status: "warn", detail: "2 posts differ" },
  ]);
  const failed = await healthResponse({ checks: [{ name: "r2", run: async () => { throw new Error("no access for a@example.com"); } }] });
  assert.equal(failed.status, 503);
  assert.deepEqual((await failed.json()).checks, [{ name: "r2", status: "fail", detail: "no access for [email]" }]);
});
