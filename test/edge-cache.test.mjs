import assert from "node:assert/strict";
import { test } from "node:test";

import { cacheKey, forReader, publicPageHeaders, settleCacheHeaders } from "../edge-cache.mjs";

// A stored page is handed to everyone: an error page, or one with no Cache-Control, must never be kept.
test("only a shared 200 keeps its edge header, and a reader with a cookie is told no-store", () => {
  const shared = () => new Headers(publicPageHeaders());
  const kept = settleCacheHeaders(new Response("ok", { headers: shared() }));
  assert.equal(kept.headers.get("Cache-Control"), "public, max-age=0");
  assert.equal(kept.headers.get("Cloudflare-CDN-Cache-Control"), "max-age=86400, stale-while-revalidate=604800");
  assert.equal(kept.headers.get("Cache-Tag"), "pages");

  const failed = settleCacheHeaders(new Response("boom", { status: 500, headers: shared() }));
  assert.equal(failed.headers.get("Cache-Control"), "private, no-store");
  assert.equal(failed.headers.get("Cloudflare-CDN-Cache-Control"), null);

  const unmarked = settleCacheHeaders(new Response("ok", { headers: { "Cloudflare-CDN-Cache-Control": "max-age=60" } }));
  assert.equal(unmarked.headers.get("Cache-Control"), "private, no-store");
  assert.equal(unmarked.headers.get("Cloudflare-CDN-Cache-Control"), null);

  const withCookie = new Request("https://example.com/", { headers: { Cookie: "a=b" } });
  assert.equal(forReader(kept, withCookie).headers.get("Cache-Control"), "private, no-store");
  assert.equal(forReader(kept, new Request("https://example.com/")), kept);
  assert.throws(() => publicPageHeaders({ tags: ["a,b"] }), /tag/);

  // A page that sets a cookie, or was rendered for a request with one, is one reader's.
  const cookieSet = settleCacheHeaders(new Response("ok", { headers: { ...publicPageHeaders(), "Set-Cookie": "s=1" } }));
  assert.equal(cookieSet.headers.get("Cache-Control"), "private, no-store");
  assert.equal(cookieSet.headers.get("Cache-Tag"), null);
  const forOne = settleCacheHeaders(new Response("ok", { headers: shared() }), withCookie);
  assert.equal(forOne.headers.get("Cache-Control"), "private, no-store");

  // A cookie the key already holds changes nothing private, so the browser may keep the page (back/forward cache).
  const themed = new Request("https://example.com/", { headers: { Cookie: "theme=dark" } });
  assert.equal(forReader(kept, themed, { publicCookies: ["theme"] }), kept);
  const themedAndSession = new Request("https://example.com/", { headers: { Cookie: "theme=dark; session=x" } });
  assert.equal(forReader(kept, themedAndSession, { publicCookies: ["theme"] }).headers.get("Cache-Control"), "private, no-store");
});

// A returning reader who holds the stored page gets 304; a page rendered after their copy does not.
test("a stored page carries the time it was rendered, and a reader holding it gets 304", () => {
  const stored = settleCacheHeaders(new Response("<p>", { headers: publicPageHeaders() }));
  const lastModified = stored.headers.get("Last-Modified");
  assert.ok(lastModified);
  const again = (headers) => forReader(stored.clone(), new Request("https://example.com/", { headers }));
  assert.equal(again({ "If-Modified-Since": lastModified }).status, 304);
  assert.equal(again({ "If-Modified-Since": new Date(Date.parse(lastModified) - 60_000).toUTCString() }).status, 200);
  const tagged = new Response("<p>", { headers: { ...publicPageHeaders(), ETag: '"a"' } });
  assert.equal(forReader(tagged, new Request("https://example.com/", { headers: { "If-None-Match": 'W/"a"' } })).status, 304);
});

// A campaign link must hit the stored page; a real query must not.
test("the key drops tracking parameters, sorts the rest and adds the page's dimensions", () => {
  assert.equal(cacheKey("https://example.com/a?utm_source=x&gclid=1&fbclid=2&_ga=3"), "/a");
  assert.equal(cacheKey("https://example.com/a?page=2&q=b&utm_medium=x"), "/a?page=2&q=b");
  assert.equal(cacheKey("https://example.com/a?q=b&page=2"), "/a?page=2&q=b");
  assert.equal(cacheKey("https://example.com/a?utm=1"), "/a?utm=1");
  assert.equal(cacheKey("https://example.com/a?q=1", { dimensions: { theme: "dark", none: undefined } }), "/a?q=1;theme=dark");
});

test("a page that lists scheduled posts stays fresh no later than the next one, and no less than a minute", () => {
  const now = new Date("2026-10-30T00:00:00Z");
  const edge = (until) => publicPageHeaders({ until, now })["Cloudflare-CDN-Cache-Control"];
  assert.equal(edge(new Date("2026-10-30T01:00:00Z")), "max-age=3600, stale-while-revalidate=604800");
  assert.equal(edge(new Date("2026-10-30T00:00:05Z")), "max-age=60, stale-while-revalidate=604800");
  assert.equal(edge(null), "max-age=86400, stale-while-revalidate=604800");
});

