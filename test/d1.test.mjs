import assert from "node:assert/strict";
import { test } from "node:test";
import { SQLiteSyncDialect, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  chunked,
  decodeCursor,
  encodeCursor,
  escapeLike,
  inList,
  likeContains,
  rowsPerInsert,
} from "../d1.mjs";

test("chunked keeps D1 under 100 bound parameters", () => {
  assert.deepEqual(chunked([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(
    chunked(Array.from({ length: 200 }, (_, i) => i)).map((part) => part.length),
    [90, 90, 20],
  );
  assert.equal(rowsPerInsert(7), 14);
});

test("likeContains matches %, _ and \\ as typed", () => {
  assert.equal(escapeLike("50%_a\\b"), "50\\%\\_a\\\\b");
  const t = sqliteTable("t", { name: text("name") });
  const q = new SQLiteSyncDialect().sqlToQuery(likeContains(t.name, "a_b%"));
  assert.equal(q.sql, `"t"."name" LIKE ? ESCAPE '\\'`);
  assert.deepEqual(q.params, ["%a\\_b\\%%"]);
});

test("inList binds any number of values as one parameter", () => {
  const t = sqliteTable("t", { id: text("id") });
  const ids = Array.from({ length: 500 }, (_, i) => `id${i}`);
  const q = new SQLiteSyncDialect().sqlToQuery(inList(t.id, ids));
  assert.equal(q.sql, `"t"."id" IN (SELECT value FROM json_each(?))`);
  assert.deepEqual(q.params, [JSON.stringify(ids)]);
});

test("a cursor keeps its id, so rows of one millisecond are not skipped; a bad one is the first page", () => {
  assert.deepEqual(decodeCursor(encodeCursor(1731300000123, "ab.c_d")), {
    at: 1731300000123,
    id: "ab.c_d",
  });
  assert.equal(decodeCursor("1731300000123"), null);
  assert.equal(decodeCursor("x.y"), null);
  assert.equal(decodeCursor(null), null);
});
