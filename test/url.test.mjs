// The trailing-slash redirect: the paths it leaves alone, and that its Location never leaves the site.
import assert from "node:assert/strict";
import { test } from "node:test";

import { canonicalRedirect, goneResponse, renameRedirect, slashRedirect } from "../url.mjs";

const at = (/** @type {string} */ path, method = "GET") => new Request(`https://example.com${path}`, { method });

test("/x/ goes to /x with its query, 308 for a POST; / and the exceptions stay", () => {
  const res = slashRedirect(at("/blog/post///?a=1&b=2"));
  assert.equal(res?.status, 301);
  assert.equal(res?.headers.get("Location"), "https://example.com/blog/post?a=1&b=2");
  assert.equal(slashRedirect(at("/form/", "POST"))?.status, 308);
  for (const path of ["/", "/blog/post", "/api/x/", "/feed/"]) assert.equal(slashRedirect(at(path), { except: ["/api/*", "/feed/"] }), null);
});

test("PLANT: a path that starts with // stays on the site", () => {
  const location = slashRedirect(at("//attacker.example/"))?.headers.get("Location");
  assert.equal(new URL(location ?? "").origin, "https://example.com");
});

test("plaintext, www and a trailing slash are one hop, and a local dev server keeps plaintext", () => {
  const one = canonicalRedirect(new Request("http://www.example.com/x/?a=1"), { host: "example.com" });
  assert.equal(one?.headers.get("Location"), "https://example.com/x?a=1");
  assert.equal(canonicalRedirect(new Request("https://example.com/x"), { host: "example.com" }), null);
  assert.equal(canonicalRedirect(new Request("http://localhost:5173/x")), null);
});

test("a gone path answers 410, by exact path, prefix or pattern, with or without its trailing slash", async () => {
  const gone = ["/blog/withdrawn", "/old-shop/*", /^\/wp-content\/uploads\/2017\//];
  for (const path of ["/blog/withdrawn/", "/old-shop/cart", "/wp-content/uploads/2017/09/a.pdf"]) {
    const res = goneResponse(at(path), gone);
    assert.equal(res?.status, 410, path);
    assert.match((await res?.text()) ?? "", /taken down on purpose/);
  }
  for (const path of ["/blog/withdrawn-not", "/old-shopping", "/"]) assert.equal(goneResponse(at(path), gone), null, path);
});

test("a renamed slug is one 301 to its newest name, keeping the rest of the path and the query", async () => {
  const renames = { "recova-vs-x": "foxhound-vs-x-old", "foxhound-vs-x-old": "foxhound-vs-x" };
  const res = await renameRedirect(at("/blog/recova-vs-x/comments?page=2"), { prefix: "/blog/", renames });
  assert.equal(res?.status, 301);
  assert.equal(res?.headers.get("Location"), "https://example.com/blog/foxhound-vs-x/comments?page=2");
  assert.equal((await renameRedirect(at("/blog/recova-vs-x", "POST"), { prefix: "/blog/", renames }))?.status, 308);
  for (const path of ["/blog/foxhound-vs-x", "/blog/", "/other/recova-vs-x", "/blog/toString"]) {
    assert.equal(await renameRedirect(at(path), { prefix: "/blog/", renames }), null, path);
  }
  // A lookup (a site's post_redirects table) may be async; a loop is refused rather than followed forever.
  const db = async (/** @type {string} */ slug) => (slug === "old" ? "new" : null);
  assert.equal((await renameRedirect(at("/old"), { prefix: "/", renames: db }))?.headers.get("Location"), "https://example.com/new");
  await assert.rejects(renameRedirect(at("/a"), { prefix: "/", renames: { a: "b", b: "a" } }), /loop/);
});
