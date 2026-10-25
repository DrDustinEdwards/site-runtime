import assert from "node:assert/strict";
import { test } from "node:test";

import { healthResponse } from "../health.mjs";

test("a stale backup is not ok but still 200; a database that throws is 503; the backup read is held for the TTL", async () => {
  let reads = 0;
  const backup = async () => (reads++, { last_ok: "2026-10-24T00:00:00Z", warning: "backup older than 26 hours" });
  const at = (/** @type {number} */ ms) => new Date(Date.UTC(2026, 9, 25) + ms);
  const first = await healthResponse({ ping: async () => 1, backup, sha: "abc123", now: at(0) });
  assert.equal(first.status, 200);
  assert.deepEqual({ ...(await first.json()), backup: undefined }, { ok: false, db: "up", backup: undefined, sha: "abc123", time: at(0).toISOString() });
  const down = await healthResponse({ ping: async () => { throw new Error("D1"); }, backup, now: at(60_000) });
  assert.equal(down.status, 503);
  assert.equal(reads, 1);
  await healthResponse({ ping: async () => 1, backup, now: at(5 * 60_000) });
  assert.equal(reads, 2);
});
