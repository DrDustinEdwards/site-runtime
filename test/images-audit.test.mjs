import assert from "node:assert/strict";
import { test } from "node:test";

import { annotation, auditImages } from "../bin/images-audit.mjs";

/** A PNG's signature and header for its size, then an eXIf chunk whose TIFF points to a GPS IFD with one entry. */
function pngWithGps(width, height) {
  const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x88, 0x25, 0, 4, 0, 0, 0, 1, 0, 0, 0, 26, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1];
  const be32 = (/** @type {number} */ n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const chunk = (/** @type {string} */ type, /** @type {number[]} */ data) => [...be32(data.length), ...Buffer.from(type), ...data, 0, 0, 0, 0];
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, ...chunk("IHDR", [...be32(width), ...be32(height), 8, 6, 0, 0, 0]), ...chunk("eXIf", tiff), ...chunk("IEND", [])]);
}

/** A JPEG's start and frame header for its size. */
function jpeg(width, height) {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0, 0]);
}

const home = `<!doctype html><html><head>
<meta property="og:image" content="https://example.com/card.jpg"><meta name="twitter:card" content="summary">
</head><body><main>
<img src="/media/big.png" alt="big.png">
<img src="/media/big.png" width="400" height="200" alt="A chart of cases">
<img src="/x.jpg" width="10" height="10">
<img src="/a.svg" width="10" height="10" alt="" fetchpriority="high"><img src="/b.svg" width="10" height="10" alt="" fetchpriority="high">
<img src="/c.svg" width="10" height="10" alt="" fetchpriority="high" loading="lazy">
<img src="/media/p.jpg?w=640" srcset="/media/p.jpg?w=640 640w" sizes="100vw" width="640" height="400" alt="A plot">
<iframe src="https://www.youtube.com/embed/abc"></iframe>
<video src="/v.mp4"></video><audio src="/a.mp3" preload="auto"></audio>
</main></body></html>`;

const responses = {
  "https://example.com/": () => new Response(home, { headers: { "content-type": "text/html" } }),
  "https://example.com/about": () => new Response("<html><head><meta name=\"twitter:card\" content=\"summary_large_image\"><meta name=\"twitter:image:alt\" content=\"x\"></head></html>", { headers: { "content-type": "text/html" } }),
  "https://example.com/sitemap.xml": () => new Response("<urlset><url><loc>https://example.com/</loc></url><url><loc>https://example.com/about</loc></url></urlset>"),
  "https://example.com/media/big.png": () => new Response(pngWithGps(2000, 1000), { headers: { "content-type": "image/png" } }),
  "https://example.com/media/p.jpg?w=640": () => new Response("webp", { headers: { "content-type": "image/webp", "cache-control": "public, max-age=3600" } }),
  "https://example.com/media/p.jpg?w=640&f=avif": () => new Response("webp", { headers: { "content-type": "image/webp", "cache-control": "public, max-age=31536000, immutable" } }),
  "https://example.com/card.jpg": () => new Response(jpeg(800, 400), { headers: { "content-type": "image/jpeg" } }),
};

test("one planted mistake from each family is found, on the page or the file that proves it", async () => {
  const requested = [];
  const fake = /** @type {typeof fetch} */ (async (/** @type {string} */ url) => {
    requested.push(url);
    const make = responses[/** @type {keyof typeof responses} */ (url.replace("https://staging.example.net", "https://example.com"))];
    return make ? make() : new Response("missing", { status: 404 });
  });
  // --from: fetched from the staging host, judged as the origin.
  const { pages, findings } = await auditImages({ origin: "https://example.com", from: "https://staging.example.net", fetch: fake });
  assert.deepEqual(pages, ["https://example.com/", "https://example.com/about"]);
  assert.ok(requested.every((url) => !url.startsWith("https://example.com/")), "every origin URL is fetched from --from");

  const items = (/** @type {string} */ id) => findings.filter((f) => f.item === id);
  assert.deepEqual([...new Set(findings.map((f) => f.item))].sort(), ["A12", "A2", "A3", "A4", "A5", "A7", "B1", "B2", "C1", "C2", "C3", "C8", "D2", "E1", "E2", "E3"]);
  assert.equal(items("A5").length, 2, "three high-priority images, one of them lazy");
  assert.equal(items("D2").length, 1, "one file with GPS, however often it is shown");
  assert.equal(items("D2")[0].url, "https://example.com/media/big.png");
  assert.match(items("A7")[0].detail, /2000 px wide for width="400"/);
  assert.equal(items("C1")[0].url, "https://example.com/about", "the page with no og:image");
  assert.deepEqual(items("C8").map((f) => f.severity), ["warning"]);
  assert.deepEqual(items("E3").map((f) => f.severity), ["warning"]);
  assert.equal(annotation({ severity: "error", item: "B1", url: "https://example.com/", detail: "100% wrong" }), "::error title=B1::https://example.com/ 100%25 wrong");
});
