import assert from "node:assert/strict";
import { test } from "node:test";

import { bootJson } from "../deferred-scripts.mjs";

// The boot a deferred page holds must be what React Router 8.5's <Scripts> would have run, and must not end its
// <script> element early. Checked end to end in Playwright's Chromium with Trusted Types enforced on germomics
// (2026-11-11): a press of play on a deferred page hydrates it, plays, and reports no violation.
test("the boot holds React Router's context, each match's modules and the preloads, as inert JSON", () => {
  const manifest = {
    url: "/assets/manifest-1.js",
    entry: { module: "/assets/entry.client-1.js", imports: ["/assets/react-1.js"] },
    routes: {
      root: { id: "root", module: "/assets/root-1.js", imports: ["/assets/chunk-1.js"] },
      post: {
        id: "post",
        module: "/assets/post-1.js",
        clientLoaderModule: "/assets/post-loader-1.js",
      },
      other: { id: "other", module: "/assets/other-1.js" },
    },
    sri: { "/assets/root-1.js": "sha384-abc" },
  };
  const matches = [{ route: { id: "root" } }, { route: { id: "post" } }];
  const handoff = '{"basename":"/","note":"\\u003c/script>"}';
  const router = {
    state: { matches, location: { pathname: "/posts/x" } },
    match: (/** @type {string} */ path) => (path === "/" ? [{ route: { id: "root" } }] : null),
  };
  const eager = bootJson({ manifest, serverHandoffString: handoff, lazy: false, router, matches });
  assert.ok(!eager.includes("<"), "nothing can close the script element");
  const boot = JSON.parse(eager);
  assert.deepEqual(boot.context, { basename: "/", note: "</script>" });
  assert.equal(boot.manifestUrl, manifest.url);
  assert.equal(boot.manifest, null);
  assert.deepEqual(boot.routes, [
    { id: "root", modules: ["/assets/root-1.js"] },
    { id: "post", modules: ["/assets/post-loader-1.js", "/assets/post-1.js"] },
  ]);
  assert.equal(boot.entry, manifest.entry.module);
  assert.deepEqual(boot.preloads[0], { href: manifest.url });
  assert.ok(boot.preloads.some((/** @type {any} */ p) => p.integrity === "sha384-abc"));
  assert.ok(!boot.preloads.some((/** @type {any} */ p) => p.href === "/assets/other-1.js"));

  // Lazy route discovery: no manifest module; the matched routes and their parents' are inlined, sri as a flag.
  const lazy = JSON.parse(
    bootJson({ manifest, serverHandoffString: handoff, lazy: true, router, matches }),
  );
  assert.equal(lazy.manifestUrl, null);
  assert.deepEqual(Object.keys(lazy.manifest.routes).sort(), ["post", "root"]);
  assert.equal(lazy.manifest.sri, true);
  assert.ok(!lazy.preloads.some((/** @type {any} */ p) => p.href === manifest.url));
});
