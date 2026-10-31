import assert from "node:assert/strict";
import { test } from "node:test";

import { annotation, auditImages } from "../bin/images.mjs";

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

// Above the fold: a lazy hero with no priority (A5). Then a long article, so everything after it is below the fold.
const home = `<!doctype html><html><head>
<meta property="og:image" content="https://example.com/card.jpg"><meta property="og:image:type" content="image/jpeg"><meta name="twitter:card" content="summary">
<link rel="preload" as="image" href="/late.png">
</head><body><header><img src="/logo.svg" width="120" height="40" alt="Example"></header><main>
<img src="/img/hero.jpg?w=1200" srcset="/img/hero.jpg?w=1200 1200w" sizes="100vw" width="1200" height="800" alt="A field at dawn" loading="lazy" decoding="async">
<p>${"Words that take up the screen. ".repeat(150)}</p>
<img src="/late.png" width="600" height="400" alt="A late chart">
<img src="/media/big.png" alt="big.png" loading="lazy" decoding="async">
<img src="/media/big.png" width="400" height="200" alt="A chart of cases" loading="lazy" decoding="async">
<img src="/x.jpg" width="10" height="10" loading="lazy" decoding="async">
<img src="/a.svg" width="10" height="10" alt="" fetchpriority="high"><img src="/c.svg" width="10" height="10" alt="" fetchpriority="high" loading="lazy">
<img src="/media/p.jpg?w=640" srcset="/media/p.jpg?w=640 640w" sizes="100vw" width="640" height="400" alt="A plot" loading="lazy" decoding="async">
<img src="https://cdn.example.org/elsewhere.png" width="10" height="10" alt="A badge" loading="lazy" decoding="async">
<a class="image-link" href="/media/linked.png">The full picture</a>
<iframe src="https://www.youtube.com/embed/abc"></iframe>
<video src="/v.mp4"></video><audio src="/a.mp3" preload="auto" controls></audio>
</main></body></html>`;

const html = (/** @type {string} */ body, /** @type {Record<string, string>} */ headers = {}) => () => new Response(body, { headers: { "content-type": "text/html", ...headers } });
/** @type {Record<string, (init?: RequestInit) => Response>} */
const responses = {
  "https://example.com/": html(home, { "content-security-policy": "default-src 'self'; img-src 'self' data:" }),
  "https://example.com/about": html('<html><head><meta name="robots" content="max-image-preview:large"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image:alt" content="x"></head></html>'),
  "https://example.com/sitemap.xml": () => new Response("<urlset><url><loc>https://example.com/</loc></url><url><loc>https://example.com/about</loc></url></urlset>"),
  "https://example.com/media/big.png": () => new Response(pngWithGps(2000, 1000), { headers: { "content-type": "image/png", "cross-origin-resource-policy": "cross-origin" } }),
  "https://example.com/media/linked.png": (init) =>
    new Response(pngWithGps(800, 600), { headers: { "content-type": "image/png", etag: '"v1"', "cross-origin-resource-policy": "same-origin" } }),
  "https://example.com/img/hero.jpg?w=1200": () => new Response("", { headers: { "content-type": "image/webp", "cache-control": "public, max-age=31536000, immutable", "cf-cache-status": "MISS", "cross-origin-resource-policy": "cross-origin" } }),
  "https://example.com/media/p.jpg?w=640": () => new Response("webp", { headers: { "content-type": "image/webp", "cache-control": "public, max-age=3600", "cf-cache-status": "HIT", "cross-origin-resource-policy": "cross-origin" } }),
  "https://example.com/card.jpg": (init) =>
    new Response(jpeg(800, 400), { headers: { "content-type": /webp/.test(init?.headers?.accept ?? "") ? "image/webp" : "image/jpeg" } }),
};

test("one planted mistake from each family is found, on the page or the file that proves it", async () => {
  const requested = [];
  const fake = /** @type {typeof fetch} */ (async (/** @type {string} */ url, /** @type {RequestInit} */ init) => {
    requested.push(url);
    const make = responses[url.replace("https://staging.example.net", "https://example.com")];
    return make ? make(init) : new Response("missing", { status: 404 });
  });
  // --from: fetched from the staging host, judged as the origin.
  const { pages, findings } = await auditImages({ origin: "https://example.com", from: "https://staging.example.net", fetch: fake });
  assert.deepEqual(pages, ["https://example.com/", "https://example.com/about"]);
  assert.ok(requested.every((url) => !url.startsWith("https://example.com/")), "every origin URL is fetched from --from");

  const items = (/** @type {string} */ id) => findings.filter((f) => f.item === id);
  const details = (/** @type {string} */ id) => items(id).map((f) => `${f.url} ${f.detail}`).join("\n");
  assert.deepEqual([...new Set(findings.map((f) => f.item))].sort(), ["A12", "A2", "A3", "A4", "A5", "A6", "A7", "B1", "B2", "C1", "C11", "C2", "C3", "C8", "C9", "D2", "E1", "E2", "E3"]);
  assert.ok(findings.every((f) => f.severity === "error" || f.item === "C2"), "only an oversized card is a warning");
  // A5: two high images, and at 1440 the hero is the largest paint (at 390 the article's text is) but lazy and not high.
  assert.match(details("A5"), /2 images are fetchpriority="high"/);
  assert.match(details("A5"), /hero\.jpg\?w=1200 is the largest image above the fold at 1440 px, likely the largest paint, and it is loading="lazy"/);
  assert.match(details("A5"), /hero\.jpg\?w=1200 is the largest image above the fold at 1440 px, likely the largest paint, with no fetchpriority="high"/);
  assert.doesNotMatch(details("A5"), /at 390 px/);
  // A6: the lazy hero above the fold; below it, an eager image and its preload. The eager logo in the header passes.
  assert.match(details("A6"), /\/late\.png is below the fold \(y≈\d+ at 390, y≈\d+ at 1440\) and not lazy \(no loading attribute\), no decoding="async"/);
  assert.match(details("A6"), /preloads https:\/\/example\.com\/late\.png, an image below the fold/);
  assert.match(details("A6"), /hero\.jpg\?w=1200 is loading="lazy" above the fold/);
  assert.doesNotMatch(details("A6"), /logo/);
  // A7 on a file with no srcset, judged at the DPR; A12 on a second request, an ETag and its 304.
  assert.match(details("A7"), /big\.png is 2000 px wide for \/media\/big\.png shown about 400 px wide at 1440 \(DPR 1\)/);
  assert.match(details("A12"), /hero\.jpg\?w=1200 asked a second time it is cf-cache-status MISS, not a HIT/);
  assert.match(details("A12"), /big\.png the original has no ETag/);
  assert.match(details("A12"), /linked\.png answers 200 to If-None-Match/);
  // D2 on the original the page only links to; C3 on the type a browser is served; C11 on CORP and CSP.
  assert.deepEqual(items("D2").map((f) => f.url), ["https://example.com/media/big.png", "https://example.com/media/linked.png"]);
  assert.match(details("C3"), /og:image:type image\/jpeg \(it is served as image\/jpeg or image\/webp\)/);
  assert.match(details("C11"), /card\.jpg the share card's Cross-Origin-Resource-Policy is "unset"/);
  assert.match(details("C11"), /linked\.png Cross-Origin-Resource-Policy is "same-origin"/);
  assert.match(details("C11"), /img-src \('self' data:\) refuses https:\/\/cdn\.example\.org\/elsewhere\.png/);
  assert.deepEqual(items("C9").map((f) => f.url), ["https://example.com/"]);
  assert.match(details("E3"), /preload="auto", no transcript link on the page/);
  assert.equal(items("C1")[0].url, "https://example.com/about", "the page with no og:image");
  assert.equal(annotation({ severity: "error", item: "B1", url: "https://example.com/", detail: "100% wrong" }), "::error title=B1::https://example.com/ 100%25 wrong");
});

test("a site that sends a stranger to a sign-in elsewhere is one C1 finding, not an audit of the sign-in page", async () => {
  const fake = /** @type {typeof fetch} */ (async () => {
    const response = new Response('<html><body><img src=""></body></html>', { headers: { "content-type": "text/html" } });
    Object.defineProperty(response, "url", { value: "https://team.cloudflareaccess.com/cdn-cgi/access/login" });
    return response;
  });
  const { findings } = await auditImages({ origin: "https://app.example.com", fetch: fake });
  assert.deepEqual(findings.map((f) => f.item), ["C1"]);
  assert.match(findings[0].detail, /sends a stranger to team\.cloudflareaccess\.com/);
});
