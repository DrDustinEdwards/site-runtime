import assert from "node:assert/strict";
import { test } from "node:test";

import { cardText, googleFont, renderShareCard, shareCardResponse } from "../share-card.mjs";

/** A stand-in renderer: it records the HTML, and returns `out` or fails. */
function fakeDraw(/** @type {Uint8Array | Error} */ out, /** @type {string[]} */ seen) {
  return async (/** @type {string} */ html) => {
    seen.push(html);
    if (out instanceof Error) throw out;
    return out;
  };
}

test("a card's text keeps & and cannot open a tag; whitespace between tags goes; the card sits in a box its size; a failed render is null", async () => {
  assert.equal(cardText("Pride & Prejudice <i>"), "Pride & Prejudice \u2039i\u203a");
  const seen = [];
  const png = await renderShareCard(
    fakeDraw(new Uint8Array([137, 80]), seen),
    "<div>\n  <div>A</div>\n</div>",
    {
      fonts: [],
      headers: { "Cross-Origin-Resource-Policy": "cross-origin" },
    },
  );
  assert.equal(
    seen[0],
    '<div style="display:flex;width:1200px;height:630px;"><div><div>A</div></div></div>',
  );
  assert.equal(png?.headers.get("Content-Type"), "image/png");
  assert.equal(png?.headers.get("Cross-Origin-Resource-Policy"), "cross-origin");
  assert.equal((await png?.arrayBuffer())?.byteLength, 2);
  assert.equal(
    await renderShareCard(fakeDraw(new Error("font"), []), "<div></div>", { fonts: [] }),
    null,
  );
  assert.equal(
    await renderShareCard(fakeDraw(new Uint8Array(), []), "<div></div>", { fonts: [] }),
    null,
  );
});

test("a Google Font is read once, then from the cache", async () => {
  const store = new Map();
  const cache = /** @type {Cache} */ (
    /** @type {unknown} */ ({
      match: async (/** @type {string} */ k) => store.get(k)?.clone(),
      put: async (/** @type {string} */ k, /** @type {Response} */ r) => void store.set(k, r),
    })
  );
  let calls = 0;
  const get = /** @type {typeof fetch} */ (
    async (url) => {
      calls++;
      return String(url).startsWith("https://fonts.googleapis.com/")
        ? new Response("src: url(https://fonts.gstatic.com/f.ttf) format('truetype');")
        : new Response(new Uint8Array([1, 2, 3]));
    }
  );
  assert.equal((await googleFont("DM Sans", 500, { cache, fetch: get }))?.byteLength, 3);
  assert.equal((await googleFont("DM Sans", 500, { cache, fetch: get }))?.byteLength, 3);
  assert.equal(calls, 2);
});

test("the card route serves the cache, renders and keeps a miss, and answers a failed render with a 503", async () => {
  const store = new Map();
  const cache = /** @type {Cache} */ (
    /** @type {unknown} */ ({
      match: async (/** @type {string} */ k) => store.get(k)?.clone(),
      put: async (/** @type {string} */ k, /** @type {Response} */ v) => void store.set(k, v),
    })
  );
  let built = 0;
  const html = () => (built++, "<div></div>");
  const ok = fakeDraw(new Uint8Array([137, 80]), []);
  const first = await shareCardResponse(ok, {
    html,
    fonts: [],
    cacheKey: "https://og.invalid/a",
    cache,
  });
  assert.equal(first.headers.get("Cross-Origin-Resource-Policy"), "cross-origin");
  assert.equal(
    (await shareCardResponse(ok, { html, fonts: [], cacheKey: "https://og.invalid/a", cache }))
      .status,
    200,
  );
  assert.equal(built, 1);
  const failed = await shareCardResponse(fakeDraw(new Error("font"), []), {
    html,
    fonts: [],
    cacheKey: "https://og.invalid/b",
    cache,
  });
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.get("Retry-After"), "300");
  assert.equal(store.has("https://og.invalid/b"), false);
});
