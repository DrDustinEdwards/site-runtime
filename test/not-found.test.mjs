// The 404 counter in an in-memory SQLite: one row per path, referring host and day, the query never kept.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { NOT_FOUND_SQL, NOT_FOUND_UPGRADE_SQL, countNotFound, notFoundKey, notFoundReport, pruneNotFound } from "../not-found.mjs";

// Foxhound's and txasm's table as their migrations create it (drizzle 0000 and 0023: the same statements).
const FIRST_SHAPE = `CREATE TABLE \`page_404_daily\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`day\` integer NOT NULL,
	\`path\` text NOT NULL,
	\`hit_count\` integer DEFAULT 0 NOT NULL
);
CREATE UNIQUE INDEX \`page_404_daily_day_path_uq\` ON \`page_404_daily\` (\`day\`,\`path\`);`;

/** A D1-shaped wrapper over node:sqlite. */
function d1(sql = NOT_FOUND_SQL) {
  const db = new DatabaseSync(":memory:");
  db.exec(sql);
  return {
    db,
    prepare: (/** @type {string} */ sql) => ({
      bind: (/** @type {any[]} */ ...v) => ({ run: async () => db.prepare(sql).run(...v), all: async () => ({ results: db.prepare(sql).all(...v) }) }),
    }),
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

test("the upgrade takes Foxhound's and txasm's table to one row per referring host, probes kept apart in the report", async () => {
  const store = d1(FIRST_SHAPE);
  const day = notFoundKey(new URL("https://example.com/"), new Date()).day;
  store.db.prepare("INSERT INTO page_404_daily (id, day, path, hit_count) VALUES ('old', ?, '/moved', 3)").run(day);
  store.db.exec(NOT_FOUND_UPGRADE_SQL);
  /** @type {Promise<unknown>[]} */
  const pending = [];
  const ctx = { waitUntil: (/** @type {Promise<unknown>} */ p) => void pending.push(p) };
  const notFound = new Response(null, { status: 404 });
  const get = (/** @type {string} */ path, referer = "") =>
    countNotFound(store, new Request(`https://example.com${path}`, { headers: referer ? { referer } : {} }), notFound, ctx);
  get("/moved", "https://blog.example.org/post/1?utm=x");
  get("/moved", "https://blog.example.org/other");
  get("/moved", "android-app://com.example");
  get("/wp-login.php");
  get("/.env");
  await Promise.all(pending);
  assert.deepEqual(await notFoundReport(store), [
    { path: "/moved", kind: "page", hits: 6, referrers: [{ host: "", hits: 4 }, { host: "blog.example.org", hits: 2 }] },
  ]);
  assert.deepEqual((await notFoundReport(store, { includeProbes: true })).map((r) => [r.path, r.kind]), [
    ["/moved", "page"],
    ["/.env", "probe"],
    ["/wp-login.php", "probe"],
  ]);
  await pruneNotFound(store, { now: new Date(day + 90 * 86_400_000) });
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM page_404_daily").get()?.n, 0);
});
