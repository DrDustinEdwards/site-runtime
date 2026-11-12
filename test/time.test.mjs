import assert from "node:assert/strict";
import { test } from "node:test";

import { parseSqlTime } from "../time.mjs";

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
