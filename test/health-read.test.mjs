import assert from "node:assert/strict";
import { test } from "node:test";
import { healthChecks, parseHealth } from "../health-read.mjs";

test("parseHealth reads the family format, the older ok bodies and Capsid's own the same way", () => {
  const read = (body) => parseHealth(JSON.stringify(body));
  assert.deepEqual(
    read({ status: "pass", ok: true, sha: "deadbeef", checks: [{ name: "db", status: "pass" }] }),
    { status: "ok", sha: "deadbeef", problem: null },
  );
  assert.deepEqual(
    read({
      status: "warn",
      ok: true,
      checks: [
        { name: "db", status: "pass" },
        { name: "backup", status: "warn", detail: "old" },
      ],
    }),
    { status: "degraded", sha: null, problem: "backup" },
  );
  assert.equal(
    read({ status: "fail", ok: false, checks: [{ name: "db", status: "fail" }] }).status,
    "down",
  );
  // A 200 that admits a problem is not healthy: ok false, or a backup warning under ok.
  assert.deepEqual(read({ ok: false, checks: [{ name: "content-drift", ok: false }] }), {
    status: "degraded",
    sha: null,
    problem: "content-drift",
  });
  assert.deepEqual(read({ ok: false }), { status: "degraded", sha: null, problem: "ok: false" });
  assert.deepEqual(
    read({ status: "ok", backup: { warning: "last successful backup was 38.4h ago" } }),
    { status: "degraded", sha: null, problem: "backup: last successful backup was 38.4h ago" },
  );
  assert.equal(read({ ok: true, db: "up", backup: { age_hours: 20 } }).status, "ok");
  assert.equal(read({ status: "down" }).status, "down");
});

test("parseHealth reads a body that does not follow the format as absent, never throwing", () => {
  const none = { status: null, sha: null, problem: null };
  assert.deepEqual(parseHealth(null), none);
  assert.deepEqual(parseHealth(""), none);
  assert.deepEqual(parseHealth("<html>ok</html>"), none);
  assert.deepEqual(parseHealth("null"), none);
  assert.deepEqual(parseHealth("[]"), none);
  assert.deepEqual(parseHealth(JSON.stringify({ status: "fine", sha: 12345 })), none);
  assert.equal(parseHealth(JSON.stringify({ status: "ok", sha: "" })).sha, null);
  assert.equal(parseHealth(JSON.stringify({ sha: "a".repeat(64) })).sha?.length, 40);
});

test("healthChecks fails closed and carries a drift check's counts", () => {
  assert.deepEqual(healthChecks({ status: "pass" }), []);
  assert.deepEqual(
    healthChecks({
      checks: [
        { name: "db", status: "pass" },
        { name: "content-drift", status: "fail", detail: "38 of 41" },
        { name: "odd" },
        { status: "pass" },
      ],
    }),
    [
      { name: "db", status: "pass", ok: true },
      {
        name: "content-drift",
        status: "fail",
        ok: false,
        detail: "38 of 41",
        present: 38,
        expected: 41,
      },
      { name: "odd", status: "fail", ok: false },
    ],
  );
});
