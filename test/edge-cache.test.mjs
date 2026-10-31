import assert from "node:assert/strict";
import { test } from "node:test";

import { cacheKey, forReader, forRenderer, publicPageHeaders, settleCacheHeaders } from "../edge-cache.mjs";

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

// germomics, 2026-10-30: a HEAD refreshed a stale page, React Router answered it with an empty 200, and the cache
// served that blank page to every reader. The Renderer only ever sees a GET, and a HEAD's answer is never stored.
test("a HEAD never renders or stores a page: the Renderer gets a GET, the reader the headers alone", async () => {
  const head = new Request("https://example.com/a?b=1", { method: "HEAD", headers: { Accept: "text/html" } });
  const sent = forRenderer(head);
  assert.equal(sent.method, "GET");
  assert.equal(sent.url, head.url);
  assert.equal(sent.headers.get("Accept"), "text/html");
  const get = new Request("https://example.com/");
  assert.equal(forRenderer(get), get);

  const stored = settleCacheHeaders(new Response("<p>page</p>", { headers: publicPageHeaders() }), sent);
  assert.equal(stored.headers.get("Cache-Tag"), "pages");
  const answered = forReader(stored, head);
  assert.equal(answered.status, 200);
  assert.equal(answered.body, null);
  assert.equal(answered.headers.get("Cache-Control"), "public, max-age=0");

  const fromHead = settleCacheHeaders(new Response(null, { headers: publicPageHeaders() }), head);
  assert.equal(fromHead.headers.get("Cache-Control"), "private, no-store");
  assert.equal(fromHead.headers.get("Cache-Tag"), null);
  const themed = new Request("https://example.com/", { headers: { Cookie: "theme=dark" } });
  assert.equal(settleCacheHeaders(new Response("ok", { headers: publicPageHeaders() }), themed, { publicCookies: ["theme"] }).headers.get("Cache-Tag"), "pages");
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


// I3. When D1 is down a re-render throws, and the reader must still get the stored page. The serving is the Workers
// cache's (developers.cloudflare.com/workers/cache/configuration/: a stale entry within stale-while-revalidate is served
// when the re-render fails, unless the entry says must-revalidate, proxy-revalidate or s-maxage). That rule is modelled
// here in a few lines, so the test holds what this package controls: the stored page's headers allow serving it stale,
// and the failed render is never stored over it.
test("with the database down, a stale stored page is served and the failed render is not stored", async () => {
  /** @type {Map<string, { response: Response, at: number }>} */
  const edge = new Map();
  const seconds = (/** @type {Response} */ r, /** @type {string} */ name) =>
    Number(new RegExp(`${name}=(\\d+)`).exec(r.headers.get("Cloudflare-CDN-Cache-Control") ?? "")?.[1] ?? 0);
  const storable = (/** @type {Response} */ r) => r.headers.get("Cache-Control") === "public, max-age=0";
  const mayServeStale = (/** @type {Response} */ r) =>
    !/must-revalidate|proxy-revalidate|s-maxage/.test(`${r.headers.get("Cache-Control")} ${r.headers.get("Cloudflare-CDN-Cache-Control")}`);
  let databaseUp = true;
  const renderer = async (/** @type {Request} */ request) => {
    let response;
    try {
      if (!databaseUp) throw new Error("D1_ERROR: database unavailable");
      response = new Response("the page", { headers: publicPageHeaders() });
    } catch {
      response = new Response("Something went wrong", { status: 500, headers: publicPageHeaders() }); // the framework's error page
    }
    return settleCacheHeaders(response, request);
  };
  const read = async (/** @type {number} */ now) => {
    const request = new Request("https://example.com/about");
    const key = cacheKey(request.url);
    const held = edge.get(key);
    const age = held ? now - held.at : Infinity;
    if (held && age <= seconds(held.response, "max-age")) return { status: "HIT", response: held.response.clone() };
    const fresh = await renderer(forRenderer(request));
    if (storable(fresh)) {
      edge.set(key, { response: fresh.clone(), at: now });
      return { status: held ? "EXPIRED" : "MISS", response: fresh };
    }
    if (held && fresh.status >= 500 && mayServeStale(held.response) && age <= seconds(held.response, "max-age") + seconds(held.response, "stale-while-revalidate")) {
      return { status: "STALE", response: held.response.clone() };
    }
    return { status: "DYNAMIC", response: fresh };
  };

  assert.equal((await read(0)).status, "MISS");
  databaseUp = false;
  const twoDaysOn = await read(2 * 86_400);
  assert.equal(twoDaysOn.status, "STALE");
  assert.equal(twoDaysOn.response.status, 200);
  assert.equal(await forReader(twoDaysOn.response, new Request("https://example.com/about")).text(), "the page");
  assert.equal(await edge.get("/about")?.response.clone().text(), "the page", "the failed render replaced the stored page");
  // Past the stale window the error shows, and is still not stored.
  assert.equal((await read(9 * 86_400)).response.status, 500);
  assert.equal(await edge.get("/about")?.response.clone().text(), "the page");
});
