import assert from "node:assert/strict";
import { test } from "node:test";
import { SQLiteSyncDialect, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { chunked, escapeLike, inChunks, likeContains, rowsPerInsert } from "../d1.mjs";

test("chunked and inChunks keep D1 under 100 bound parameters; an empty list runs nothing", async () => {
  assert.deepEqual(chunked([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  const sizes = [];
  const rows = await inChunks(
    Array.from({ length: 200 }, (_, i) => i),
    async (part) => {
      sizes.push(part.length);
      return part;
    },
  );
  assert.deepEqual(sizes, [90, 90, 20]);
  assert.equal(rows.length, 200);
  let ran = false;
  assert.deepEqual(await inChunks([], async () => ((ran = true), [])), []);
  assert.equal(ran, false);
  assert.equal(rowsPerInsert(7), 14);
});

test("likeContains matches %, _ and \\ as typed", () => {
  assert.equal(escapeLike("50%_a\\b"), "50\\%\\_a\\\\b");
  const t = sqliteTable("t", { name: text("name") });
  const q = new SQLiteSyncDialect().sqlToQuery(likeContains(t.name, "a_b%"));
  assert.equal(q.sql, `"t"."name" LIKE ? ESCAPE '\\'`);
  assert.deepEqual(q.params, ["%a\\_b\\%%"]);
});
