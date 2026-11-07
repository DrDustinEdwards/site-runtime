import assert from "node:assert/strict";
import { test } from "node:test";

import { staticSite } from "../static-site.mjs";

// An asset server with a page, a script and a 404 page, whose responses have immutable headers as on Workers.
const frozen = (/** @type {Response} */ response) => {
  Object.defineProperty(response.headers, "set", {
    value: () => {
      throw new TypeError("Can't modify immutable headers.");
    },
  });
  return response;
};
const ASSETS = {
  async fetch(/** @type {Request} */ request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/")
      return frozen(
        new Response("<p>home", {
          headers: { "Content-Type": "text/html", "Cache-Control": "public, max-age=300" },
        }),
      );
    if (pathname === "/404")
      return frozen(
        new Response("<p>gone", {
          headers: { "Content-Type": "text/html", "Content-Security-Policy": "default-src 'none'" },
        }),
      );
    if (pathname === "/app.js")
      return frozen(new Response("1", { headers: { "Content-Type": "text/javascript" } }));
    return frozen(
      new Response("not found", { status: 404, headers: { "Content-Type": "text/plain" } }),
    );
  },
};
const site = staticSite({
  headers: { "X-Content-Type-Options": "nosniff" },
  preload: "</site.css>; rel=preload; as=style",
});
const get = (/** @type {string} */ path, /** @type {Record<string, string>} */ headers = {}) =>
  site.fetch(new Request(`https://example.com${path}`, { headers }), { ASSETS });

test("a page gets the speed headers, a missing path the 404 page uncached, and a file passes through", async () => {
  const page = await get("/");
  assert.equal(page.headers.get("Link"), "</site.css>; rel=preload; as=style");
  assert.equal(page.headers.get("Speculation-Rules"), '"/speculation-rules.json"');
  assert.match(page.headers.get("Server-Timing") ?? "", /^asset;dur=/);
  assert.equal(page.headers.get("Content-Type"), "text/html; charset=utf-8");
  assert.equal(page.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(page.headers.get("Cache-Control"), "public, max-age=300");

  assert.equal(
    (await get("/", { Cookie: "a=1" })).headers.get("Cache-Control"),
    "private, no-store",
  );

  const missing = await get("/nope");
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), "<p>gone");
  assert.equal(missing.headers.get("Cache-Control"), "private, no-store");
  assert.equal(missing.headers.get("Content-Security-Policy"), "default-src 'none'");
  assert.equal(missing.headers.get("Link"), null);

  assert.equal((await get("/app.js")).headers.get("Speculation-Rules"), null);
  assert.equal(
    (await get("/speculation-rules.json")).headers.get("Content-Type"),
    "application/speculationrules+json",
  );

  // devkit's worker-deploy waits for /health to report the commit it deployed.
  const health = await site.fetch(new Request("https://example.com/health"), {
    ASSETS,
    DEPLOY_SHA: "abc1234",
  });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).sha, "abc1234");
  assert.equal(health.headers.get("X-Content-Type-Options"), "nosniff");

  const http = await site.fetch(new Request("http://example.com/about/"), { ASSETS });
  assert.equal(http.status, 301);
  assert.equal(http.headers.get("Location"), "https://example.com/about");
  assert.equal(http.headers.get("X-Content-Type-Options"), "nosniff");
});

test("the 404 page's own address answers 404, and a site in maintenance answers 503 but for /health", async () => {
  const direct = await site.fetch(new Request("https://example.com/404"), { ASSETS });
  assert.equal(direct.status, 404);

  const env = { ASSETS, MAINTENANCE: "true" };
  const down = await staticSite({ siteName: "Sample" }).fetch(
    new Request("https://example.com/"),
    env,
  );
  assert.equal(down.status, 503);
  assert.equal(down.headers.get("Retry-After"), "3600");
  assert.equal(down.headers.get("Cache-Control"), "private, no-store");
  assert.match(await down.text(), /<title>Down for maintenance \| Sample<\/title>/);
  const health = await staticSite().fetch(new Request("https://example.com/health"), env);
  assert.equal(health.status, 200);
});
