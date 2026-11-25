// The 404 counter in an in-memory SQLite: one row per path, referring host and day, the query never kept.
import assert from "node:assert/strict";
import { d1 } from "./sqlite-d1.mjs";
import { test } from "node:test";

import {
  NOT_FOUND_DAILY_ROWS,
  NOT_FOUND_OVERFLOW,
  NOT_FOUND_SQL,
  NOT_FOUND_UPGRADE_SQL,
  REDIRECTS_SQL,
  addRedirect,
  countNotFound,
  d1Redirects,
  listRedirects,
  notFoundKey,
  notFoundReport,
  pruneNotFound,
  NOT_FOUND_MAX_PENDING,
  recordNotFound,
  redirectEntry,
  removeRedirect,
  tableRedirect,
} from "../not-found.mjs";

// The first shape of the 404 table, before the referring host column.
const FIRST_SHAPE = `CREATE TABLE \`page_404_daily\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`day\` integer NOT NULL,
	\`path\` text NOT NULL,
	\`hit_count\` integer DEFAULT 0 NOT NULL
);
CREATE UNIQUE INDEX \`page_404_daily_day_path_uq\` ON \`page_404_daily\` (\`day\`,\`path\`);`;

test("a 404 to a GET adds to its path's row for the day; the query, a POST and a 200 count nothing", async () => {
  const store = d1(NOT_FOUND_SQL);
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
  assert.deepEqual(
    rows.map((r) => [r.path, r.hit_count]),
    [["/gone", 2]],
  );
  assert.equal(rows[0]?.day, notFoundKey(new URL("https://example.com/"), new Date()).day);
  assert.equal(notFoundKey(new URL("https://example.com/_.data")).path, "/");
  // Past the day's cap a new path folds into "(overflow)"; a counted one still adds.
  store.db
    .prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
       INSERT INTO page_404_daily (id, day, path, hit_count) SELECT 'f' || i, ?, '/fill-' || i, 1 FROM n`,
    )
    .run(NOT_FOUND_DAILY_ROWS - 1, rows[0]?.day);
  for (const path of ["/new-a", "/new-b", "/gone"])
    await recordNotFound(store, new URL(`https://example.com${path}`));
  const after = Object.fromEntries(
    store.db
      .prepare(
        "SELECT path, hit_count FROM page_404_daily WHERE path IN ('/gone', '/new-a', '/new-b', ?)",
      )
      .all(NOT_FOUND_OVERFLOW)
      .map((r) => [r.path, r.hit_count]),
  );
  assert.deepEqual(after, { "/gone": 3, [NOT_FOUND_OVERFLOW]: 2 });
});

test("the upgrade takes a first-shape table to one row per referring host, probes kept apart in the report", async () => {
  const store = d1(FIRST_SHAPE);
  const day = notFoundKey(new URL("https://example.com/"), new Date()).day;
  store.db
    .prepare("INSERT INTO page_404_daily (id, day, path, hit_count) VALUES ('old', ?, '/moved', 3)")
    .run(day);
  store.db.exec(NOT_FOUND_UPGRADE_SQL);
  /** @type {Promise<unknown>[]} */
  const pending = [];
  const ctx = { waitUntil: (/** @type {Promise<unknown>} */ p) => void pending.push(p) };
  const notFound = new Response(null, { status: 404 });
  const get = (/** @type {string} */ path, referer = "") =>
    countNotFound(
      store,
      new Request(`https://example.com${path}`, { headers: referer ? { referer } : {} }),
      notFound,
      ctx,
    );
  get("/moved", "https://blog.example.org/post/1?utm=x");
  get("/moved", "https://blog.example.org/other");
  get("/moved", "android-app://com.example");
  get("/wp-login.php");
  get("/.env");
  await Promise.all(pending);
  assert.deepEqual(await notFoundReport(store), [
    {
      path: "/moved",
      kind: "page",
      hits: 6,
      referrers: [
        { host: "", hits: 4 },
        { host: "blog.example.org", hits: 2 },
      ],
    },
  ]);
  assert.deepEqual(
    (await notFoundReport(store, { includeProbes: true })).map((r) => [r.path, r.kind]),
    [
      ["/moved", "page"],
      ["/.env", "probe"],
      ["/wp-login.php", "probe"],
    ],
  );
  await pruneNotFound(store, { now: new Date(day + 90 * 86_400_000) });
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM page_404_daily").get()?.n, 0);
});

test("a scanner's guesses are probes and a site's pages stay pages", () => {
  const kind = (/** @type {string} */ path) =>
    notFoundKey(new URL(`https://example.com${path}`)).kind;
  for (const path of [
    "/backup.zip",
    "/web.config",
    "/server-status",
    "/vendor/phpunit/x",
    "/.git/config",
  ])
    assert.equal(kind(path), "probe", path);
  for (const path of ["/blog/zip-codes", "/server-statistics", "/blog/secret-garden", "/web"])
    assert.equal(kind(path), "page", path);
});

test("the redirect table: one step adds a 301, a chain is one hop, a loop is refused", async () => {
  const store = d1(REDIRECTS_SQL);
  await addRedirect(store, { from: "/old/", to: "/middle" });
  await addRedirect(store, { from: "/middle", to: "/new" });
  assert.deepEqual((await listRedirects(store)).map((r) => [r.from, r.to, r.status]).sort(), [
    ["/middle", "/new", 301],
    ["/old", "/new", 301],
  ]);
  await assert.rejects(addRedirect(store, { from: "/new", to: "/old" }), /loop/);
  assert.throws(() => redirectEntry({ from: "/a", to: "//evil.example/" }), /to is a path/);

  const get = await tableRedirect(
    new Request("https://example.com/old/?ref=x"),
    d1Redirects(store),
  );
  assert.equal(get?.status, 301);
  assert.equal(get?.headers.get("location"), "https://example.com/new?ref=x");
  const post = await tableRedirect(new Request("https://example.com/old", { method: "POST" }), [
    { from: "/old", to: "/a" },
    { from: "/a", to: "https://other.example/b" },
  ]);
  assert.equal(post?.status, 308);
  assert.equal(post?.headers.get("location"), "https://other.example/b");
  assert.equal(
    await tableRedirect(new Request("https://example.com/here"), d1Redirects(store)),
    null,
  );
  await removeRedirect(store, "/old");
  assert.equal(
    await tableRedirect(new Request("https://example.com/old"), d1Redirects(store)),
    null,
  );
});

test("a burst of 404s queues at most NOT_FOUND_MAX_PENDING writes on the database", async () => {
  let writes = 0;
  const db = {
    prepare: () => ({
      bind: () => ({
        run: () => (writes++, new Promise(() => {})),
        all: async () => ({ results: [] }),
      }),
    }),
  };
  const ctx = { waitUntil() {} };
  for (let i = 0; i < 50; i++)
    countNotFound(db, new Request(`https://example.com/p${i}`), { status: 404 }, ctx);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(writes, NOT_FOUND_MAX_PENDING);
});
