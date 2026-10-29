import assert from "node:assert/strict";
import { test } from "node:test";

import { speculationRules, speculationRulesResponse } from "../prefetch.mjs";

// A prefetch is a real GET: one that reached /logout or an admin action would act for the reader. Chrome's behavior
// with these rules was checked in Playwright's Chromium under a strict CSP (2026-10-29): the file is read, a hovered
// page link is prefetched, /admin and data-no-prefetch links are not.
test("the rules never reach signed-in areas, APIs or a sign-out, and refuse a malformed exclusion", async () => {
  const res = speculationRulesResponse({ exclude: ["/drafts"] });
  assert.equal(res.headers.get("content-type"), "application/speculationrules+json");
  const text = await res.text();
  for (const path of ["/admin", "/admin/*", "/api/*", "/logout", "/drafts/*"]) assert.ok(text.includes(`"href_matches":"${path}"`), path);
  assert.ok(!text.includes("prerender"));
  assert.throws(() => speculationRulesResponse({ exclude: ["drafts*"] }), /path prefix/);
});

// Checked in Playwright's Chromium 153 under a strict CSP with the Speculation-Rules header (2026-10-29): a hovered
// /page-a is prefetched, /notes.md, /feed.xml and /search?q=x are not, and with excludeQueries false /search?q=x is.
test("links to files and links with a query string are not prefetched, unless the site lets queries through", () => {
  const rules = (/** @type {object} */ options) => JSON.stringify(speculationRules(options));
  const text = rules({});
  for (const ext of ["md", "xml", "json", "txt", "rss", "atom", "pdf", "zip"]) assert.ok(text.includes(`"href_matches":"/*.${ext}"`), ext);
  assert.ok(text.includes('"href_matches":{"pathname":"/*","search":"(.+)"}'));
  assert.ok(!rules({ excludeQueries: false }).includes('"search"'));
});
