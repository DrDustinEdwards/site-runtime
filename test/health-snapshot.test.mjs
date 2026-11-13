// Moved from dustinedwards.info (test/health-snapshot.test.mjs).
/* A stored snapshot risks a cached page presenting an old or malformed verdict as current, so
 * every uncertain input must resolve to `missing` rather than a green tile. */

import test from "node:test";
import assert from "node:assert/strict";

import {
  HEALTH_SNAPSHOT_EVERY_MINUTES,
  healthTile,
  snapshotFromBody,
} from "../health-snapshot.mjs";

const HEALTH_SNAPSHOT_STALE_AFTER_SECONDS = 3 * HEALTH_SNAPSHOT_EVERY_MINUTES * 60;

const NOW = Date.parse("2026-08-26T14:00:00.000Z");

/** @param {number} secondsAgo */
function snapshotAgedBy(secondsAgo, overrides = {}) {
  return {
    ok: true,
    total: 5,
    failed: 0,
    checks: ["db", "backup", "media", "content-drift", "fts-equality"].map((name) => ({
      name,
      status: "pass",
    })),
    readAt: new Date(NOW - secondsAgo * 1000).toISOString(),
    ...overrides,
  };
}

await test("a snapshot inside the window is fresh and carries its age", () => {
  const tile = healthTile(snapshotAgedBy(120), NOW);
  assert.equal(tile.state, "fresh");
  assert.equal(tile.ageSeconds, 120);
  assert.equal(tile.ok, true);
  assert.equal(tile.total, 5);
  assert.equal(tile.failed, 0);
});

await test("THE BOUNDARY IS INCLUSIVE: exactly three intervals old is still fresh", () => {
  assert.equal(healthTile(snapshotAgedBy(HEALTH_SNAPSHOT_STALE_AFTER_SECONDS), NOW).state, "fresh");
  assert.equal(
    healthTile(snapshotAgedBy(HEALTH_SNAPSHOT_STALE_AFTER_SECONDS + 1), NOW).state,
    "stale",
  );
});

await test("a FAILING verdict is still shown, with the failed count intact", () => {
  // A snapshot that recorded only healthy runs would let the tile keep showing
  // the last good answer while the site was failing.
  const tile = healthTile(snapshotAgedBy(60, { ok: false, failed: 2 }), NOW);
  assert.equal(tile.state, "fresh");
  assert.equal(tile.ok, false);
  assert.equal(tile.failed, 2);
});

await test("absence is missing, in every form KV can hand back", () => {
  for (const value of [null, undefined, "", 0, false, "a string", 42]) {
    assert.equal(healthTile(value, NOW).state, "missing", `for ${JSON.stringify(value)}`);
  }
});

await test("FAILS CLOSED on every malformed field, one at a time", () => {
  const cases = {
    "readAt absent": { readAt: undefined },
    "readAt not a string": { readAt: 1787779776701 },
    "readAt unparseable": { readAt: "not a date" },
    "ok not a boolean": { ok: "yes" },
    "total not a number": { total: "5" },
    "failed not a number": { failed: null },
    "checks absent": { checks: undefined },
    "checks short of the total": { checks: [{ name: "db", status: "pass" }] },
    "a check with no status": { checks: Array.from({ length: 5 }, (_, i) => ({ name: `c${i}` })) },
  };
  for (const [name, override] of Object.entries(cases)) {
    assert.equal(healthTile(snapshotAgedBy(60, override), NOW).state, "missing", name);
  }
});

await test("A FUTURE TIMESTAMP IS REFUSED, not clamped to zero", () => {
  // It means the writer's clock or the shape is wrong, and neither is a state
  // to render a green tile from. Clamping would show it as freshest of all.
  assert.equal(healthTile(snapshotAgedBy(-60), NOW).state, "missing");
});

await test("snapshotFromBody keeps each /health check's name and status, and no detail", () => {
  const body = {
    status: "warn",
    ok: true,
    checks: [
      { name: "db", status: "pass" },
      { name: "content-drift", status: "warn", detail: "14 of 16" },
      { name: "media", status: "pass" },
      { name: "backup", status: "warn", detail: "newest complete dump is 30 hours old" },
    ],
  };
  assert.deepEqual(snapshotFromBody(body, "2026-08-26T14:00:00.000Z"), {
    ok: false,
    total: 4,
    failed: 2,
    readAt: "2026-08-26T14:00:00.000Z",
    checks: [
      { name: "db", status: "pass" },
      { name: "content-drift", status: "warn" },
      { name: "media", status: "pass" },
      { name: "backup", status: "warn" },
    ],
  });
});

await test("a body that is not a /health answer is never stored", () => {
  for (const body of [null, {}, { status: "fail" }, { checks: [] }, "<html>"]) {
    assert.equal(snapshotFromBody(body, "2026-08-26T14:00:00.000Z"), null, JSON.stringify(body));
  }
});

await test("body to snapshot to tile round trips what the colophon renders", () => {
  const body = {
    status: "pass",
    checks: ["db", "media", "fts-equality"].map((name) => ({ name, status: "pass" })),
  };
  const tile = healthTile(snapshotFromBody(body, new Date(NOW - 30_000).toISOString()), NOW);
  assert.equal(tile.state, "fresh");
  assert.equal(tile.total, 3);
  assert.equal(tile.failed, 0);
  assert.equal(tile.checks.length, 3);
});
