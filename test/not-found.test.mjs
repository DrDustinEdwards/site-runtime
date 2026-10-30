// The 404 counter against Foxhound's table in an in-memory SQLite: one row per path per day, the query never kept.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { NOT_FOUND_SQL, countNotFound, notFoundKey } from "../not-found.mjs";

/** A D1-shaped wrapper over node:sqlite. */
function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec(NOT_FOUND_SQL);
  return {
    db,
    prepare: (/** @type {string} */ sql) => ({ bind: (/** @type {any[]} */ ...v) => ({ run: async () => db.prepare(sql).run(...v) }) }),
  };
}

test("a 404 to a GET adds to its path's row for the day; the query, a POST and a 200 count nothing", async () => {
  const store = d1();
  /** @type {Promise<unknown>[]} */
  const pending = [];
  const ctx = { waitUntil: (/** @type {Promise<unknown>} */ p) => void pending.push(p) };
  const notFound = new Response(null, { status: 404 });
  countNotFound(store, new Request("https://example.com/gone?token=secret"), notFound, ctx);
  countNotFound(store, new Request("https://example.com/gone.data"), notFound, ctx);
  countNotFound(store, new Request("https://example.com/gone", { method: "POST" }), notFound, ctx);
  countNotFound(store, new Request("https://example.com/here"), new Response("ok"), ctx);
  await Promise.all(pending);
  const rows = store.db.prepare("SELECT day, path, hit_count FROM page_404_daily").all();
  assert.deepEqual(rows.map((r) => [r.path, r.hit_count]), [["/gone", 2]]);
  assert.equal(rows[0]?.day, notFoundKey(new URL("https://example.com/"), new Date()).day);
  assert.equal(notFoundKey(new URL("https://example.com/_.data")).path, "/");
});
