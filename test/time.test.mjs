import assert from "node:assert/strict";
import { test } from "node:test";

import { dayKey, parseSqlTime, toSqlTime } from "../time.mjs";

test("parseSqlTime reads D1's zoneless text as UTC and keeps a zone that is given", () => {
  const utc = Date.UTC(2026, 10, 11, 23, 5, 9);
  assert.equal(parseSqlTime("2026-11-11 23:05:09"), utc);
  assert.equal(parseSqlTime("2026-11-11T23:05:09"), utc);
  assert.equal(parseSqlTime("2026-11-11T23:05:09.000Z"), utc);
  assert.equal(parseSqlTime("2026-11-11T17:05:09-06:00"), utc);
  assert.equal(parseSqlTime("2026-11-11 17:05:09-0600"), utc);
  assert.equal(parseSqlTime("2026-11-11 23:05"), utc - 9000);
  assert.equal(parseSqlTime("2026-11-11"), Date.UTC(2026, 10, 11));
  assert.equal(parseSqlTime(""), null);
  assert.equal(parseSqlTime("soon"), null);
});

test("toSqlTime writes D1's text in UTC and parseSqlTime reads it back", () => {
  const ms = Date.UTC(2026, 10, 11, 23, 5, 9);
  assert.equal(toSqlTime(ms), "2026-11-11 23:05:09");
  assert.equal(parseSqlTime(toSqlTime(new Date(ms))), ms);
  assert.throws(() => toSqlTime("nope"), RangeError);
});

test("dayKey is the day in the zone it is given, and reads stored text as UTC", () => {
  const at = Date.UTC(2026, 0, 1, 3);
  assert.equal(dayKey(at, "UTC"), "2026-01-01");
  assert.equal(dayKey(new Date(at), "America/Chicago"), "2025-12-31");
  assert.equal(dayKey("2026-01-01 03:00:00", "America/Chicago"), "2025-12-31");
  assert.equal(dayKey("2026-01-01T03:00:00Z", "Asia/Tokyo"), "2026-01-01");
  assert.throws(() => dayKey("soon", "UTC"), RangeError);
});
