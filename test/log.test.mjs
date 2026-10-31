// The log line and its scrubbers: what a person's data looks like after them, and the line's shape.
import assert from "node:assert/strict";
import { test } from "node:test";

import { logEvent, routeNamer, scrubFields, scrubText, scrubUrl } from "../log.mjs";

test("emails, URL queries, Stripe keys, Drizzle parameters and route tokens are cut", () => {
  assert.equal(
    scrubText("mail a.b+c@example.com via https://example.com/verify?token=abc#x key sk_live_123 and whsec_9"),
    "mail [email] via https://example.com/verify key [key] and [key]",
  );
  assert.equal(scrubText("Failed query: insert into t values (?)\nparams: x@example.com,Ann"), "Failed query: insert into t values (?)\nparams: [redacted]");
  const tokenPath = /\/(u|e\/[och])\/[^/?#\s'"]+/g;
  assert.equal(scrubUrl("/e/o/tok123?next=/me", { tokenPath }), "/e/o/[token]");
  assert.equal(scrubText("GET /u/abc then /u/def", { tokenPath }), "GET /u/[token] then /u/[token]");
  assert.deepEqual(scrubFields({ path: "/a?code=1", headers: { cookie: "s" }, nested: { email: "x@example.com" }, n: 3 }), {
    path: "/a",
    nested: { email: "[email]" },
    n: 3,
  });
});

test("a line is one JSON object with the event first, and a field cannot rename it", () => {
  const lines = [];
  const original = console.log;
  console.log = (/** @type {string} */ line) => lines.push(line);
  try {
    logEvent("signed_in", { event: "other", error: new Error("for x@example.com") });
  } finally {
    console.log = original;
  }
  assert.equal(lines[0], '{"event":"signed_in","error":"Error: for [email]"}');
});

test("routeNamer names the most specific React Router pattern, a .data fetch as its page", () => {
  const name = routeNamer({
    root: { path: "" },
    "routes/home": { parentId: "root", index: true },
    "routes/blog": { parentId: "root", path: "blog" },
    "routes/blog.$slug": { parentId: "routes/blog", path: ":slug" },
    "routes/blog.new": { parentId: "routes/blog", path: "new" },
    "routes/$lang?.about": { parentId: "root", path: ":lang?/about" },
    "routes/$": { parentId: "root", path: "*" },
  });
  const at = (/** @type {string} */ path) => name(new Request(`https://example.com${path}`));
  assert.equal(at("/blog/new"), "/blog/new");
  assert.equal(at("/blog/a-post"), "/blog/:slug");
  assert.equal(at("/blog/a-post.data"), "/blog/:slug");
  assert.equal(at("/about"), "/:lang?/about");
  assert.equal(at("/no/such/page"), "/*");
  assert.equal(at("/"), "/");
});
