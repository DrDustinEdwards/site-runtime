// The trailing-slash redirect: the paths it leaves alone, and that its Location never leaves the site.
import assert from "node:assert/strict";
import { test } from "node:test";

import { slashRedirect } from "../url.mjs";

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
