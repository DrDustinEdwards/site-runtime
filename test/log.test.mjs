// The log line and its scrubbers: what a person's data looks like after them, and the line's shape.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  handleServerError,
  logEvent,
  routeNamer,
  scrubFields,
  scrubText,
  scrubUrl,
  withRequestLog,
} from "../log.mjs";

test("emails, URL queries, Stripe keys, Drizzle parameters and route tokens are cut", () => {
  assert.equal(
    scrubText(
      "mail a.b+c@example.com via https://example.com/verify?token=abc#x key sk_live_123 and whsec_9",
    ),
    "mail [email] via https://example.com/verify key [key] and [key]",
  );
  const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.c2lnbmF0dXJlLWJ5dGVz";
  assert.equal(
    scrubText(
      `401 for sk-ant-api03-abcdefghijklmnop1234 and ghp_${"a".repeat(36)} with Bearer abcdef0123456789abcdef and ${jwt}`,
    ),
    "401 for [key] and [key] with [key] and [key]",
  );
  const plain = "no Bearer here, and a short sk-ant-x stays";
  assert.equal(scrubText(plain), plain);
  assert.equal(
    scrubText("Failed query: insert into t values (?)\nparams: x@example.com,Ann"),
    "Failed query: insert into t values (?)\nparams: [redacted]",
  );
  const tokenPath = /\/(u|e\/[och])\/[^/?#\s'"]+/g;
  assert.equal(scrubUrl("/e/o/tok123?next=/me", { tokenPath }), "/e/o/[token]");
  assert.equal(
    scrubText("GET /u/abc then /u/def", { tokenPath }),
    "GET /u/[token] then /u/[token]",
  );
  assert.deepEqual(
    scrubFields({
      path: "/a?code=1",
      headers: { cookie: "s" },
      nested: { email: "x@example.com" },
      n: 3,
    }),
    {
      path: "/a",
      nested: { email: "[email]" },
      n: 3,
    },
  );
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

test("withRequestLog names the route, and a refused input also writes input_validation_fail", async (t) => {
  /** @type {Record<string, unknown>[]} */
  const lines = [];
  for (const level of ["log", "warn", "error"])
    t.mock.method(console, level, (/** @type {string} */ line) => lines.push(JSON.parse(line)));
  const fetch = withRequestLog(
    async (request) =>
      new Response(null, { status: new URL(request.url).pathname === "/form" ? 422 : 200 }),
    {
      route: (request) => new URL(request.url).pathname,
    },
  );
  await fetch(new Request("https://example.com/form?email=a@example.com", { method: "POST" }));
  await fetch(new Request("https://example.com/ok"));
  assert.deepEqual(
    lines.map(({ event, route, status }) => ({ event, route, status })),
    [
      { event: "request", route: "/form", status: 422 },
      { event: "input_validation_fail", route: "/form", status: 422 },
      { event: "request", route: "/ok", status: 200 },
    ],
  );
});

test("handleServerError skips a route 404 and logs any other error with its request", () => {
  const request = new Request("https://example.com/blog/robots.txt?token=abc");
  const lines = [];
  const original = console.error;
  console.error = (line) => lines.push(line);
  try {
    handleServerError(
      { status: 404, statusText: "Not Found", error: new Error("No route matches URL") },
      { request },
    );
    assert.equal(lines.length, 0);
    handleServerError(new Error("boom"), { request });
    assert.equal(lines.length, 1);
    const line = JSON.parse(lines[0]);
    assert.equal(line.event, "server_error");
    assert.equal(line.path, "/blog/robots.txt");
    assert.equal(line.error, "Error: boom");
  } finally {
    console.error = original;
  }
});
