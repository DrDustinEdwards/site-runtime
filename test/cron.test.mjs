// The job runner and its /health check against cron_runs in an in-memory SQLite.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { CRON_SKIPPED, CRON_SQL, cronCheck, cronFindings, runJobs } from "../cron.mjs";

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
  assert.equal(await cronCheck(store, at(11)).run(), true);
  // publish runs every minute: its own interval plus 10 minutes of grace.
  assert.deepEqual(await cronCheck(store, at(12)).run(), { ok: false, detail: "publish stale" });
});

test("a hung job times out as failed and the next still runs; a daily job warns past about 26 hours; a job that never ran warns", async () => {
  const store = d1();
  const t0 = Date.UTC(2026, 9, 30);
  const ran = [];
  /** @type {AbortSignal | undefined} */
  let seen;
  const jobs = [
    { name: "hung", everyMinutes: 1440, timeoutMs: 20, run: (/** @type {AbortSignal} */ signal) => ((seen = signal), new Promise(() => {})) },
    { name: "backup", everyMinutes: 1440, run: async () => void ran.push("backup") },
  ];
  await assert.rejects(runJobs(store, jobs, { now: () => t0, timeoutMs: 60_000 }), /cron jobs failed: hung$/);
  assert.deepEqual(ran, ["backup"]);
  assert.equal(seen?.aborted, true);
  assert.equal(store.db.prepare("SELECT last_error FROM cron_runs WHERE name = 'hung'").get()?.last_error, "Error: timed out after 20 ms");

  const registered = [jobs[1], { name: "prune", everyMinutes: 1440 }];
  const at = (/** @type {number} */ minutes) => new Date(t0 + minutes * 60_000);
  // 1440 + 144 minutes: the deploy is recent, so prune's absence is not yet a warning.
  assert.equal(await cronCheck(store, { jobs: registered, deployedAt: at(0), now: at(1584) }).run(), true);
  assert.deepEqual(await cronCheck(store, { jobs: registered, deployedAt: at(0), now: at(1585) }).run(), { ok: false, detail: "backup stale, prune never ran" });
});

test("a job held on timeout is recorded failed and waited for before the next starts; a skip records no success", async () => {
  const store = d1();
  const t0 = Date.UTC(2026, 9, 30);
  const order = [];
  const jobs = [
    { name: "money", everyMinutes: 5, timeoutMs: 10, holdOnTimeout: true, run: () => new Promise((done) => setTimeout(() => done(order.push("money ended")), 40)) },
    { name: "next", everyMinutes: 5, run: async () => void order.push("next") },
    { name: "gated", everyMinutes: 5, run: async () => CRON_SKIPPED },
  ];
  await assert.rejects(runJobs(store, jobs, { now: () => t0 }), /cron jobs failed: money$/);
  assert.deepEqual(order, ["money ended", "next"]);
  const row = (/** @type {string} */ name) => store.db.prepare("SELECT last_ok_at, last_failed_at FROM cron_runs WHERE name = ?").get(name);
  assert.deepEqual({ ...row("money") }, { last_ok_at: null, last_failed_at: t0 });
  assert.equal(row("gated")?.last_ok_at, null);
  assert.deepEqual(await cronFindings(store, { jobs: [{ name: "money", everyMinutes: 5 }], now: new Date(t0) }), [{ name: "money", reason: "failed", lastOkAt: null }]);
});
