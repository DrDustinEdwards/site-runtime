// The job runner and its /health check against cron_runs in an in-memory SQLite.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { CRON_SQL, cronCheck, runJobs } from "../cron.mjs";

/** A D1-shaped wrapper over node:sqlite. */
function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec(CRON_SQL);
  return {
    db,
    prepare: (/** @type {string} */ sql) => ({
      bind: (/** @type {any[]} */ ...v) => ({ run: async () => db.prepare(sql).run(...v), all: async () => ({ results: db.prepare(sql).all(...v) }) }),
    }),
  };
}

test("a failed job does not stop the next, the run throws naming it, and the check sees failed and stale jobs", async () => {
  const store = d1();
  const t0 = Date.UTC(2026, 9, 30);
  const ran = [];
  const jobs = [
    { name: "backup", everyMinutes: 60, run: async () => { throw new Error("R2 down for x@example.com"); } },
    { name: "publish", everyMinutes: 1, run: async () => void ran.push("publish") },
  ];
  await assert.rejects(runJobs(store, jobs, { now: () => t0 }), /cron jobs failed: backup/);
  assert.deepEqual(ran, ["publish"]);
  assert.equal(store.db.prepare("SELECT last_error FROM cron_runs WHERE name = 'backup'").get()?.last_error, "Error: R2 down for [email]");

  const at = (/** @type {number} */ minutes) => ({ now: new Date(t0 + minutes * 60_000) });
  assert.deepEqual(await cronCheck(store, at(5)).run(), { ok: false, detail: "backup failed" });
  await runJobs(store, [{ ...jobs[0], run: async () => {} }], { now: () => t0 + 60_000 });
  assert.equal(await cronCheck(store, at(12)).run(), true);
  // publish runs every minute: 2 x 1 + 10 minutes of grace.
  assert.deepEqual(await cronCheck(store, at(13)).run(), { ok: false, detail: "publish stale" });
});
