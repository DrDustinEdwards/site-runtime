import assert from "node:assert/strict";
import { test } from "node:test";

import { escapeHtml } from "../html.mjs";
import { defineImages, pictureHtml } from "../image.mjs";

const images = defineImages({
  uses: {
    content: { layout: "constrained", width: 704 },
    tile: { layout: "fixed", width: 160, ratio: "1x1" },
  },
});

/** An R2 object stand-in. */
function object(type = "image/jpeg", focus) {
  return {
    body: new Response("original").body,
    httpEtag: '"e1"',
    httpMetadata: { contentType: type },
    customMetadata: focus ? { focus } : {},
    writeHttpMetadata(/** @type {Headers} */ h) {
      h.set("content-type", type);
    },
  };
}

/** A binding stand-in that records each transform. */
function binding(/** @type {object[]} */ seen) {
  return {
    input: () => ({
      transform: (/** @type {object} */ t) => ({
        output: async (/** @type {{ format: string, quality: number }} */ o) => {
          seen.push({ ...t, ...o });
          return { response: () => new Response("small", { headers: { "content-type": o.format } }) };
        },
      }),
    }),
  };
}

test("a page asks only for sizes the route serves: Astro's widths, capped at the original, AVIF before WebP", async () => {
  const attrs = images.attributes({ src: "/media/a.jpg", width: 1200, height: 800 }, "content");
  // 704 and its double are added to the screen widths, then everything above the original goes.
  assert.deepEqual(attrs.srcset?.split(", ").map((s) => s.split(" ")[1]), ["640w", "704w", "750w", "828w", "1080w"]);
  assert.equal(attrs.sizes, "(min-width: 704px) 704px, 100vw");
  assert.deepEqual([attrs.width, attrs.height], [704, 469]);
  assert.equal(attrs.sources[0].type, "image/avif");
  assert.match(attrs.sources[0].srcset, /\/media\/a\.jpg\?w=640&f=avif 640w/);
  // No size known, or not a raster: the original, unsized.
  assert.equal(images.attributes({ src: "/media/b.svg", width: 10, height: 10 }, "content").srcset, undefined);
  assert.equal(images.attributes({ src: "/media/c.jpg", width: null, height: null }, "content").sources.length, 0);

  const html = pictureHtml(attrs, { alt: 'A "plot"', priority: true }, escapeHtml);
  assert.match(html, /^<picture><source type="image\/avif"/);
  assert.match(html, /alt="A &quot;plot&quot;" loading="eager" fetchpriority="high"/);

  const seen = [];
  for (const url of attrs.srcset?.split(", ").map((s) => s.split(" ")[0]) ?? []) {
    const res = await images.respond(new Request(`https://example.com${url}`), { object: object(), images: binding(seen) });
    assert.equal(res.status, 200);
  }
  assert.equal(seen.length, 5);
  assert.deepEqual(seen[0], { width: 640, fit: "scale-down", format: "image/webp", quality: 85 });
});

test("the route refuses anything outside its closed sets, crops around the file's own focal point, and never serves SVG inline", async () => {
  const at = (/** @type {string} */ q) => new Request(`https://example.com/media/a.jpg${q}`);
  for (const q of ["?w=641", "?w=640&f=png", "?w=320&r=3x2", "?w=640&fp=0.5x0.5"]) {
    assert.equal((await images.respond(at(q), { object: object(), images: binding([]) })).status, 400, q);
  }

  const tile = images.attributes({ src: "/media/a.jpg", width: 1200, height: 800, focus: "0.25x0.5" }, "tile");
  assert.deepEqual([tile.width, tile.height], [160, 160]);
  const first = /** @type {string} */ (tile.srcset).split(" ")[0];
  assert.equal(first, "/media/a.jpg?w=160&r=1x1&fp=0.25x0.5");
  const seen = [];
  assert.equal((await images.respond(at(first.slice("/media/a.jpg".length)), { object: object("image/jpeg", "0.25x0.5"), images: binding(seen) })).status, 200);
  assert.deepEqual(seen[0], { width: 160, height: 160, fit: "cover", gravity: "0.25x0.5", format: "image/webp", quality: 85 });
  // The file's focal point moved: the old URL is refused, not served as a stale crop.
  assert.equal((await images.respond(at("?w=160&r=1x1&fp=0.25x0.5"), { object: object("image/jpeg", "0.7x0.2"), images: binding([]) })).status, 400);

  const svg = await images.respond(at(""), { object: object("image/svg+xml") });
  assert.equal(svg.headers.get("content-disposition"), "attachment");
  assert.equal((await images.respond(new Request("https://example.com/media/a.jpg", { headers: { "if-none-match": '"e1"' } }), { object: object() })).status, 304);
});
