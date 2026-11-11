import assert from "node:assert/strict";
import { test } from "node:test";
import { defineSite, siteWorker } from "../worker.mjs";

const build = { routes: { root: { path: "" } }, assets: { routes: { root: { css: [] } } } };

function harness(options = {}) {
  /** @type {{ request: Request, key: string }[]} */
  const stored = [];
  const site = defineSite({
    name: "Sample",
    serverBuild: async () => /** @type {any} */ (build),
    withSecurityHeaders: (response) => {
      const out = new Response(response.body, response);
      out.headers.set("X-Set", "1");
      return out;
    },
    publicCookies: ["theme"],
    ...options,
  });
  const worker = siteWorker(site);
  const ctx = /** @type {any} */ ({
    waitUntil() {},
    exports: {
      Renderer: {
        async fetch(/** @type {Request} */ request, /** @type {any} */ init) {
          stored.push({ request, key: init.cf.cacheKey });
          return new Response("<p>page</p>", {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "public, max-age=0",
              "Content-Security-Policy": "default-src 'self'",
              ETag: '"v1"',
            },
          });
        },
      },
    },
  });
  const env = /** @type {any} */ ({});
  return { worker, stored, fetch: (/** @type {Request} */ r) => worker.fetch(r, env, ctx), env };
}

test("a cookieless or theme-only read goes to the Renderer, keyed on host and theme; a 304 has no policy", async () => {
  const { fetch, stored } = harness();
  const page = await fetch(new Request("https://example.com/about"));
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("Speculation-Rules"), '"/speculation-rules.json"');
  await fetch(new Request("https://example.com/about", { headers: { Cookie: "theme=dark" } }));
  assert.deepEqual(
    stored.map((s) => s.key),
    ["/about;host=example.com", "/about;host=example.com;theme=dark"],
  );
  // A 304 leaves out the policy, so the reader's copy keeps its own nonce.
  const reply = await fetch(
    new Request("https://example.com/about", { headers: { "If-None-Match": '"v1"' } }),
  );
  assert.equal(reply.status, 304);
  assert.equal(reply.headers.get("Content-Security-Policy"), null);
});

test("any other cookie, a write or a refused path never reaches the Renderer", async () => {
  const { fetch, stored } = harness({
    cacheable: (_r, url) => !url.pathname.startsWith("/account"),
  });
  // The live render has no real build here, so it fails into the plain 500 with the set.
  const signedIn = await fetch(
    new Request("https://example.com/about", { headers: { Cookie: "session=x" } }),
  );
  assert.equal(signedIn.status, 500);
  assert.equal(signedIn.headers.get("X-Set"), "1");
  await fetch(new Request("https://example.com/account"));
  await fetch(new Request("https://example.com/about", { method: "POST" }));
  assert.equal(stored.length, 0);
});

test("the canonical move, security.txt and a cross-site write are answered before the page", async () => {
  const { fetch, stored } = harness({
    canonical: { host: "example.com", keep: (/** @type {URL} */ url) => url.pathname === "/old/" },
  });
  const moved = await fetch(new Request("http://www.example.com/a/"));
  assert.equal(moved.status, 301);
  assert.equal(moved.headers.get("Location"), "https://example.com/a");
  assert.equal(moved.headers.get("X-Set"), "1");
  const kept = await fetch(new Request("http://example.com/old/"));
  assert.equal(kept.headers.get("Location"), "https://example.com/old/");
  const txt = await fetch(new Request("https://example.com/.well-known/security.txt"));
  assert.match(await txt.text(), /^Contact: /m);
  const refused = await fetch(
    new Request("https://example.com/contact", {
      method: "POST",
      headers: { "Sec-Fetch-Site": "cross-site", Origin: "https://evil.example" },
    }),
  );
  assert.equal(refused.status, 403);
  assert.equal(stored.length, 0);
});

test("a site step answers first, gets the set, then the site's respond; a cron's lists may be a promise", async () => {
  /** @type {unknown[]} */
  const crons = [];
  const { fetch, worker, env } = harness({
    steps: [(r) => (new URL(r.url).pathname === "/media/x" ? new Response("img") : undefined)],
    respond: (/** @type {Response} */ response, _r, _e, /** @type {any} */ where) => {
      response.headers.set("X-Stored", String(where.stored));
      return response;
    },
    cron: async (_env, _at, /** @type {any} */ ctx) => {
      crons.push(ctx.tag);
      return {};
    },
  });
  const media = await fetch(new Request("https://example.com/media/x"));
  assert.equal(await media.text(), "img");
  assert.equal(media.headers.get("X-Set"), "1");
  assert.equal(media.headers.get("X-Stored"), "false");
  const ctx = /** @type {any} */ ({ tag: "ctx" });
  await worker.scheduled(/** @type {any} */ ({ cron: "1 2 * * *", scheduledTime: 0 }), env, ctx);
  assert.deepEqual(crons, ["ctx"]);
});
