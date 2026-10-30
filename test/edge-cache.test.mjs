import assert from "node:assert/strict";
import { test } from "node:test";

import { forReader, publicPageHeaders, settleCacheHeaders } from "../edge-cache.mjs";

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
});
