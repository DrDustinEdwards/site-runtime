import assert from "node:assert/strict";
import { test } from "node:test";

import { CRON_SKIPPED } from "../cron.mjs";
import { decideAcquire, decideRelease, tick, withLease } from "../cron-lock/index.mjs";

// Moved from Foxhound's cron-lock plants (310 item 1, 376 item 14) and its ticker test.
const MINUTE = 60_000;

/** The Durable Object's read, decide, write, over a plain record. */
function lockStub() {
  /** @type {{ heldUntil: number, token: string } | null} */
  let record = null;
  let clock = 0;
  let n = 0;
  const lock = {
    at: (/** @type {number} */ t) => (clock = t),
    held: () => record !== null,
    async acquire(/** @type {number} */ leaseMs) {
      const decision = decideAcquire(record, clock, leaseMs, `t${++n}`);
      if (!decision.granted) return null;
      record = decision.record;
      return record.token;
    },
    async release(/** @type {string} */ token) {
      if (decideRelease(record, token)) record = null;
    },
  };
  return { lock, ns: { idFromName: (/** @type {string} */ name) => name, get: () => lock } };
}

test("an overrunning run's late release does not free the next run's lease", async () => {
  const { lock } = lockStub();
  const a = await lock.acquire(16 * MINUTE);
  lock.at(16 * MINUTE); // A's lease has lapsed, so B gets in: a dead run never wedges the job.
  assert.ok(await lock.acquire(16 * MINUTE));
  lock.at(17 * MINUTE);
  await lock.release(/** @type {string} */ (a));
  assert.equal(lock.held(), true);
  assert.equal(await lock.acquire(16 * MINUTE), null);
});

test("withLease skips a held job without running it, and releases after a throw", async () => {
  const { lock, ns } = lockStub();
  await lock.acquire(MINUTE);
  let ran = 0;
  assert.equal(await withLease(ns, "job", MINUTE, async () => ran++), CRON_SKIPPED);
  assert.equal(ran, 0);
  lock.at(2 * MINUTE);
  await assert.rejects(
    withLease(ns, "job", MINUTE, async () => Promise.reject(new Error("boom"))),
    /boom/,
  );
  assert.equal(lock.held(), false);
});

test("the ticker re-arms before it runs, so a throwing run leaves the chain alive", async () => {
  /** @type {number[]} */
  const alarms = [];
  await tick(
    { setAlarm: async (at) => void alarms.push(at) },
    () => Promise.reject(new Error("boom")),
    300_000,
    1000,
  );
  assert.deepEqual(alarms, [301_000]);
});
