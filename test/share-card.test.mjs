import assert from "node:assert/strict";
import { test } from "node:test";

import { cardText, googleFont, renderShareCard } from "../share-card.mjs";

/** A stand-in for workers-og's ImageResponse: it records the HTML, and streams `bytes` or fails mid-stream. */
function fakeImageResponse(/** @type {Uint8Array | Error} */ out, /** @type {string[]} */ seen) {
  return class extends Response {
    constructor(/** @type {string} */ html) {
      seen.push(html);
      const body = new ReadableStream({
        pull(c) {
          if (out instanceof Error) c.error(out);
          else (c.enqueue(out), c.close());
        },
      });
      super(body);
    }
  };
}

test("a card's text keeps & and cannot open a tag; whitespace between tags goes; the card sits in a box its size; a failed render is null", async () => {
  assert.equal(cardText("Pride & Prejudice <i>"), "Pride & Prejudice \u2039i\u203a");
  const seen = [];
  const png = await renderShareCard(fakeImageResponse(new Uint8Array([137, 80]), seen), "<div>\n  <div>A</div>\n</div>", {
    fonts: [],
    headers: { "Cross-Origin-Resource-Policy": "cross-origin" },
  });
  assert.equal(seen[0], '<div style="display:flex;width:1200px;height:630px;"><div><div>A</div></div></div>');
  assert.equal(png?.headers.get("Content-Type"), "image/png");
  assert.equal(png?.headers.get("Cross-Origin-Resource-Policy"), "cross-origin");
  assert.equal((await png?.arrayBuffer())?.byteLength, 2);
  assert.equal(await renderShareCard(fakeImageResponse(new Error("font"), []), "<div></div>", { fonts: [] }), null);
  assert.equal(await renderShareCard(fakeImageResponse(new Uint8Array(), []), "<div></div>", { fonts: [] }), null);
});

test("a Google Font is read once, then from the cache", async () => {
  const store = new Map();
  const cache = /** @type {Cache} */ (/** @type {unknown} */ ({
    match: async (/** @type {string} */ k) => store.get(k)?.clone(),
    put: async (/** @type {string} */ k, /** @type {Response} */ r) => void store.set(k, r),
  }));
  let calls = 0;
  const get = /** @type {typeof fetch} */ (async (url) => {
    calls++;
    return String(url).startsWith("https://fonts.googleapis.com/")
      ? new Response("src: url(https://fonts.gstatic.com/f.woff) format('woff');")
      : new Response(new Uint8Array([1, 2, 3]));
  });
  assert.equal((await googleFont("DM Sans", 500, { cache, fetch: get }))?.byteLength, 3);
  assert.equal((await googleFont("DM Sans", 500, { cache, fetch: get }))?.byteLength, 3);
  assert.equal(calls, 2);
});
