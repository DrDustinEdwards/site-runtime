import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContentSecurityPolicy } from "../csp.mjs";
import { EMBED_FRAME_SOURCES, permissionsAllowingEmbeds } from "../embeds.mjs";
import { buildSecurityHeaders } from "../headers.mjs";
import { prelum } from "../sites.mjs";

test("an entry that embeds lets the players into its frames with their features, and refuses an enforced COEP", () => {
  const permissions = buildSecurityHeaders({ site: prelum })["Permissions-Policy"] ?? "";
  for (const feature of ["autoplay", "encrypted-media", "fullscreen", "picture-in-picture"]) assert.match(permissions, new RegExp(`${feature}=\\(self "https://www.youtube-nocookie.com"`), feature);
  assert.match(permissions, /camera=\(\)/);
  assert.ok(permissions.length < 2000, "the header fits one line of Cloudflare's _headers");
  assert.equal(permissionsAllowingEmbeds("fullscreen=(self), camera=()").split(", ").length, 5);

  const frames = /frame-src ([^;]+)/.exec(buildContentSecurityPolicy({ embeds: true, sources: { frame: ["https://www.google.com"] } }).value)?.[1].split(" ");
  assert.deepEqual(frames, ["'self'", "https://www.google.com", ...EMBED_FRAME_SOURCES.filter((o) => o !== "https://www.google.com")]);

  const enforced = { ...prelum, optIns: { ...prelum.optIns, coep: { value: /** @type {const} */ ("credentialless"), reason: "a test of the refusal" } } };
  assert.throws(() => buildSecurityHeaders({ site: enforced }), /keep it reportOnly/);
});
