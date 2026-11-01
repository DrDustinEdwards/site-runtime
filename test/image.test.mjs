import assert from "node:assert/strict";
import { test } from "node:test";

import { escapeHtml } from "../html.mjs";
import { defineImages, editImage, imagePreload, originalKey, pictureHtml, pictureProps } from "../image.mjs";
import { preloads } from "../preload.mjs";

const images = defineImages({
  uses: {
    content: { layout: "constrained", width: 704 },
    tile: { layout: "fixed", width: 160, ratio: "1x1" },
  },
});

/** An R2 object stand-in. */
function object(type = "image/jpeg", focus, etag = '"e1"') {
  return {
    body: new Response("original").body,
    httpEtag: etag,
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
  assert.match(attrs.sources[0].srcset, /\/media\/a\.jpg\.avif\?w=640 640w/);
  // No size known, or not a raster: the original, unsized.
  assert.equal(images.attributes({ src: "/media/b.svg", width: 10, height: 10 }, "content").srcset, undefined);
  assert.equal(images.attributes({ src: "/media/c.jpg", width: null, height: null }, "content").sources.length, 0);

  const html = pictureHtml(attrs, { alt: 'A "plot"', priority: true }, escapeHtml);
  assert.match(html, /^<picture><source type="image\/avif"/);
  assert.match(html, /alt="A &quot;plot&quot;" loading="eager" fetchpriority="high"/);
  // The JSX props are the same picture: one source of truth.
  const props = pictureProps(attrs, { alt: "A plot" });
  assert.deepEqual(props.sources[0], { type: "image/avif", srcSet: attrs.sources[0].srcset, sizes: attrs.sizes, media: undefined });
  assert.equal(props.img.srcSet, attrs.srcset);
  assert.deepEqual([props.img.loading, props.img.fetchPriority], ["lazy", undefined]);

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
  assert.equal(first, "/media/a.jpg.webp?w=160&r=1x1&fp=0.25x0.5");
  const seen = [];
  assert.equal((await images.respond(new Request(`https://example.com${first}`), { object: object("image/jpeg", "0.25x0.5"), images: binding(seen) })).status, 200);
  assert.deepEqual(seen[0], { width: 160, height: 160, fit: "cover", gravity: "0.25x0.5", format: "image/webp", quality: 85 });
  // The file's focal point moved: the old URL is refused, not served as a stale crop.
  assert.equal((await images.respond(at("?w=160&r=1x1&fp=0.25x0.5"), { object: object("image/jpeg", "0.7x0.2"), images: binding([]) })).status, 400);

  const svg = await images.respond(at(""), { object: object("image/svg+xml") });
  assert.equal(svg.headers.get("content-disposition"), "attachment");
  assert.equal((await images.respond(new Request("https://example.com/media/a.jpg", { headers: { "if-none-match": '"e1"' } }), { object: object() })).status, 304);
});

test("a GIF stays animated, offers no AVIF of its motion, and its still frame is only for reduced motion", async () => {
  const attrs = images.attributes({ src: "/media/loop.gif", width: 800, height: 600 }, "content");
  assert.deepEqual(attrs.sources.map((s) => [s.type, s.media ?? null]), [
    ["image/avif", "(prefers-reduced-motion: reduce)"],
    ["image/webp", "(prefers-reduced-motion: reduce)"],
    ["image/webp", null],
  ]);
  assert.match(attrs.sources[0].srcset, /\/media\/loop\.gif\.avif\?w=640&still=1 640w/);
  assert.match(pictureHtml(attrs, { alt: "" }, escapeHtml), /<source type="image\/avif" srcset="[^"]+" sizes="[^"]+" media="\(prefers-reduced-motion: reduce\)">/);

  const seen = [];
  const at = (/** @type {string} */ q) => new Request(`https://example.com/media/loop.gif${q}`);
  assert.equal((await images.respond(at("?w=640"), { object: object("image/gif"), images: binding(seen) })).status, 200);
  assert.equal((await images.respond(at("?w=640&still=1"), { object: object("image/gif"), images: binding(seen) })).status, 200);
  assert.deepEqual(seen.map((s) => /** @type {{ anim?: boolean }} */ (s).anim), [undefined, false]);
  // A still is one more billed transform per size, so nothing but a GIF has one.
  assert.equal((await images.respond(at("?w=640&still=1"), { object: object("image/jpeg"), images: binding(seen) })).status, 400);
  assert.equal((await images.respond(at("?w=640&still=0"), { object: object("image/gif"), images: binding(seen) })).status, 400);
  assert.equal(seen.length, 2);
});

test("a failed transform serves the original for five minutes, never caches it, and says so", async () => {
  const failing = { input: () => { throw new Error("planted transform failure"); } };
  const put = [];
  const cache = /** @type {Cache} */ (/** @type {unknown} */ ({ match: async () => undefined, put: async (/** @type {Request} */ k) => put.push(k) }));
  const at = new Request("https://example.com/media/a.jpg?w=640");
  const res = await images.respond(at, { object: object(), images: failing, cache, reread: async () => object() });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-image"), "original-fallback");
  assert.equal(res.headers.get("cache-control"), "public, max-age=300");
  assert.equal(await res.text(), "original");
  assert.equal(put.length, 0);
  // Nothing to read again: a 503 the browser retries, not an empty 200.
  assert.equal((await images.respond(at, { object: object(), images: failing })).status, 503);
});

test("a site that keeps its old widths as breakpoints still serves its cached links", async () => {
  const kept = defineImages({ uses: { content: { layout: "constrained", width: 704 } }, breakpoints: [640, 1024, 1408] });
  assert.deepEqual(kept.widths, [640, 704, 1024, 1408]);
  const res = await kept.respond(new Request("https://example.com/media/a.jpg?w=1024"), { object: object(), images: binding([]) });
  assert.equal(res.status, 200);
});

test("a file replaced under the same key never answers a size cached from the old bytes", async () => {
  const stored = new Map();
  const cache = /** @type {Cache} */ (/** @type {unknown} */ ({
    match: async (/** @type {Request} */ k) => stored.get(k.url)?.clone(),
    put: async (/** @type {Request} */ k, /** @type {Response} */ r) => void stored.set(k.url, r),
  }));
  const at = () => new Request("https://example.com/media/a.jpg?w=640");
  const seen = [];
  await images.respond(at(), { object: object(), images: binding(seen), cache });
  await images.respond(at(), { object: object(), images: binding(seen), cache });
  assert.equal(seen.length, 1);
  await images.respond(at(), { object: object("image/jpeg", undefined, '"e2"'), images: binding(seen), cache });
  assert.equal(seen.length, 2);
});

test("an edit shrinks inside a square, reads a view's own bytes, re-encodes on a format alone, and refuses a bad option unbilled", async () => {
  const seen = [];
  let read = "";
  const images = {
    input: (/** @type {ReadableStream} */ stream) => {
      const done = new Response(stream).text().then((t) => void (read = t));
      return { transform: (/** @type {object} */ t) => ({ output: async (/** @type {object} */ o) => (await done, seen.push({ ...t, ...o }), { response: () => new Response("edited") }) }) };
    },
  };
  // A view into a larger buffer: only its own bytes reach the binding.
  const view = new TextEncoder().encode("xxpicturexx").subarray(2, 9);
  const res = await editImage(images, view, { rotate: 90, flip: "h", maxEdge: 4096, format: "image/jpeg" });
  assert.equal(await res.text(), "edited");
  assert.equal(read, "picture");
  assert.deepEqual(seen[0], { flip: "h", rotate: 90, width: 4096, height: 4096, fit: "scale-down", format: "image/jpeg", quality: 85 });
  for (const bad of [{ rotate: 45 }, { flip: "x" }, { maxEdge: 0 }, { rotate: 90, format: "image/gif" }]) {
    await assert.rejects(editImage(images, view, /** @type {any} */ ({ format: "image/png", ...bad })));
  }
  assert.equal(seen.length, 1);
  // A format alone (HEIC to JPEG on upload) re-encodes with no transform.
  const reencoded = [];
  const direct = { input: () => ({ transform: () => assert.fail("no transform for a re-encode"), output: async (/** @type {object} */ o) => (reencoded.push(o), { response: () => new Response("jpeg") }) }) };
  assert.equal(await (await editImage(direct, view, { format: "image/jpeg" })).text(), "jpeg");
  assert.deepEqual(reencoded, [{ format: "image/jpeg", quality: 85 }]);
});

test("a replaced file is a new URL, an old URL still answers, and the version mints no transform", async () => {
  const stored = new Map();
  const cache = /** @type {Cache} */ (/** @type {unknown} */ ({
    match: async (/** @type {Request} */ k) => stored.get(k.url)?.clone(),
    put: async (/** @type {Request} */ k, /** @type {Response} */ r) => void stored.set(k.url, r),
  }));
  const photo = { src: "/media/a.jpg", width: 1200, height: 800, version: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08" };
  const before = images.attributes(photo, "content").src;
  const after = images.attributes({ ...photo, version: "2026-10-31T12:00:00Z" }, "content").src;
  assert.equal(before, "/media/a.jpg.webp?v=9f86d081884c&w=704");
  assert.notEqual(after, before);
  assert.equal(originalKey("a.jpg.webp", `https://example.com${before}`), "a.jpg");
  assert.equal(originalKey("a.webp", "https://example.com/media/a.webp?w=640"), "a.webp");

  const seen = [];
  const answer = (/** @type {string} */ path) => images.respond(new Request(`https://example.com${path}`), { object: object(), images: binding(seen), cache });
  for (const path of [before, after, "/media/a.jpg?w=704", "/media/a.jpg.webp?v=anything&w=704"]) {
    const res = await answer(path);
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get("cross-origin-resource-policy"), "cross-origin");
  }
  // One transform: the version and the suffix name the same bytes the etag already keys.
  assert.equal(seen.length, 1);
  assert.equal((await answer("/media/a.jpg.webp?w=704&f=avif")).status, 400);
  assert.equal((await answer("/media/a.jpg?w=704&v=a%20b")).status, 400);
  assert.equal((await answer("/media/a.jpg.jpg?w=704")).status, 400);
  assert.equal((await images.respond(new Request("https://example.com/media/a.jpg"), { object: object() })).headers.get("cross-origin-resource-policy"), "cross-origin");
});

test("the stored placeholder shows behind an opaque picture while it loads, and only a value in the contract reaches the style", () => {
  const photo = { src: "/media/a.jpg", width: 1200, height: 800, focus: "0.25x0.5", placeholder: "data:image/webp;base64,UklGRg==", color: "#A1b2c3" };
  const { img } = pictureProps(images.attributes(photo, "content"), { alt: "" });
  assert.deepEqual(img.style, { background: '#a1b2c3 url("data:image/webp;base64,UklGRg==") 25% 50%/cover no-repeat' });
  assert.match(pictureHtml(images.attributes(photo, "content"), { alt: "" }, escapeHtml), / style="background:#a1b2c3 url\(&quot;data:image\/webp;base64,UklGRg==&quot;\) 25% 50%\/cover no-repeat">/);
  // A PNG may be clear in places; a value outside the contract is dropped.
  assert.equal(images.attributes({ ...photo, src: "/media/a.png" }, "content").background, undefined);
  assert.equal(images.attributes({ ...photo, placeholder: 'data:image/svg+xml,")', color: "red" }, "content").background, undefined);
});

test("the share crop and the Article set are sizes the route serves, and a preload names the set the page shows", async () => {
  const shared = defineImages({ uses: { content: { layout: "constrained", width: 704 } }, shareImages: true });
  const photo = { src: "/media/a.jpg", width: 900, height: 600, focus: "0.25x0.5", version: 1761912000000 };
  const card = /** @type {NonNullable<ReturnType<typeof shared.shareImage>>} */ (shared.shareImage(photo));
  assert.deepEqual({ ...card, url: undefined }, { url: undefined, width: 1200, height: 630, type: "image/jpeg" });
  assert.deepEqual(shared.articleImages(photo).map((i) => `${i.width}x${i.height}`), ["1200x675", "1200x900", "1200x1200"]);
  const seen = [];
  for (const { url } of [card, ...shared.articleImages(photo)]) {
    const res = await shared.respond(new Request(`https://example.com${url}`), { object: object("image/jpeg", "0.25x0.5"), images: binding(seen) });
    assert.equal(res.status, 200, url);
  }
  assert.deepEqual(seen[0], { width: 1200, height: 630, fit: "cover", gravity: "0.25x0.5", format: "image/jpeg", quality: 85 });
  assert.equal(shared.shareImage({ ...photo, src: "/media/a.svg" }), null);
  // Without shareImages the crops are outside the closed sets.
  assert.equal((await images.respond(new Request(`https://example.com${card.url}`), { object: object("image/jpeg", "0.25x0.5"), images: binding([]) })).status, 400);

  const { links, header } = preloads([imagePreload(shared.attributes(photo, "content"))]);
  assert.equal(links[0].type, "image/avif");
  assert.match(header, /^<\/media\/a\.jpg\.webp\?v=[a-z0-9]+&w=704>; rel=preload; as=image; type="image\/avif"; imagesrcset="\/media\/a\.jpg\.avif\?[^"]+ 640w, [^"]+"; imagesizes="\(min-width: 704px\) 704px, 100vw"; fetchpriority=high$/);
  assert.throws(() => preloads([{ href: "/f.woff2", as: "font", imageSrcSet: "/a 1w" }]), /image/);
});

test("over Cloudflare's 1,200 px AVIF limit the AVIF source names the WebP, and the route sends an AVIF it could not write there", async () => {
  const wide = defineImages({ uses: { hero: { layout: "full-width" } } });
  const attrs = wide.attributes({ src: "/media/w.jpg", width: 2048, height: 1089 }, "hero");
  const avif = attrs.sources[0].srcset.split(", ");
  assert.match(avif.find((c) => c.endsWith(" 1080w")) ?? "", /\/media\/w\.jpg\.avif\?w=1080 1080w/);
  assert.match(avif.find((c) => c.endsWith(" 2048w")) ?? "", /\/media\/w\.jpg\.webp\?w=2048 2048w/);

  // The binding fell back to WebP: a 301 to the .webp twin, never a WebP named .avif.
  const fallback = { input: () => ({ transform: () => ({ output: async () => ({ response: () => new Response("small", { headers: { "content-type": "image/webp" } }) }) }) }) };
  const res = await wide.respond(new Request("https://example.com/media/w.jpg.avif?v=abc123&w=2048"), { object: object(), images: fallback });
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("location"), "/media/w.jpg.webp?v=abc123&w=2048");
  assert.match(res.headers.get("cache-control") ?? "", /immutable/);
});

test("a size cached under one Cache-Control never answers under another (the site may pick it per request)", async () => {
  const store = new Map();
  const cache = /** @type {Cache} */ (/** @type {unknown} */ ({ match: async (/** @type {Request} */ k) => store.get(k.url)?.clone(), put: async (/** @type {Request} */ k, /** @type {Response} */ r) => void store.set(k.url, r) }));
  const at = () => new Request("https://example.com/media/a.jpg.webp?v=abc123&w=640");
  await images.respond(at(), { object: object(), images: binding([]), cache, cacheControl: "public, max-age=86400" });
  const res = await images.respond(at(), { object: object(), images: binding([]), cache, cacheControl: "public, max-age=31536000, immutable" });
  assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
});
