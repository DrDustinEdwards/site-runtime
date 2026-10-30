import assert from "node:assert/strict";
import { test } from "node:test";

import { preloads } from "../preload.mjs";

// A font preload without crossorigin is a second request for the same file, in the page and in the 103 alike.
test("a font gets crossorigin in both the links and the header, and a bad href is refused", () => {
  const { links, header } = preloads([
    { href: "/fonts/a.woff2", as: "font", type: "font/woff2" },
    { href: "/logo.webp", as: "image" },
    { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  ]);
  assert.deepEqual(links[0], { rel: "preload", href: "/fonts/a.woff2", as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  assert.equal(
    header,
    '</fonts/a.woff2>; rel=preload; as=font; type="font/woff2"; crossorigin=anonymous, </logo.webp>; rel=preload; as=image, <https://fonts.gstatic.com>; rel=preconnect; crossorigin=anonymous',
  );
  assert.throws(() => preloads([{ href: "/a b.woff2", as: "font" }]), /href/);
  assert.throws(() => preloads([{ href: "//cdn.example.com/a.woff2", as: "font" }]), /href/);
});
