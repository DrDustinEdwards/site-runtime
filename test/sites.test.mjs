import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSecurityHeaders, failures } from "../check.mjs";
import { buildContentSecurityPolicy } from "../csp.mjs";
import { buildSecurityHeaders } from "../headers.mjs";
import { SITES, bsw, capsomer as capsomerEntry, dustinedwardsInfo, siteForOrigin } from "../sites.mjs";

const page = (/** @type {Record<string, string>} */ set, /** @type {import("../csp.mjs").SitePolicy} */ policy) =>
  new Headers({ ...set, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": buildContentSecurityPolicy({ reportUri: "/csp-report", ...policy }).value });

test("every entry builds, and a page built from its entry passes the check graded by the same entry", () => {
  for (const entry of SITES) {
    const { id, optIns = {} } = entry;
    const policy = Object.fromEntries(Object.entries(optIns).filter(([k]) => k !== "passkey").map(([k, v]) => [k, v.value]));
    assert.deepEqual(failures(checkSecurityHeaders(page(buildSecurityHeaders({ site: entry }), policy), { site: id })), [], id);
  }
});

test("an undeclared deviation fails: an opt-in another site declared, or a gap left out of the entry", () => {
  const capsomer = page(buildSecurityHeaders({ site: capsomerEntry }), { framedBySameOrigin: true, cloudflareWebAnalytics: true });
  assert.deepEqual(failures(checkSecurityHeaders(capsomer, { site: "prelum" })).map((r) => r.id).sort(), ["H3", "H5"]);
  const oneYear = page({ ...buildSecurityHeaders({ site: dustinedwardsInfo }), "Strict-Transport-Security": "max-age=31536000; includeSubDomains" }, { cloudflareWebAnalytics: true });
  assert.deepEqual(failures(checkSecurityHeaders(oneYear, { site: "dustinedwards-info" })).map((r) => r.id), ["T2"]);
  assert.throws(() => checkSecurityHeaders(new Headers(), { site: "nowhere" }), /not in the site registry/);
  // @ts-expect-error an id is refused: the Worker imports its entry, so the registry stays out of its bundle
  assert.throws(() => buildSecurityHeaders({ site: "bsw" }), /not its id/);
  assert.throws(() => buildSecurityHeaders({ site: bsw, overrides: {} }), /not both/);
});

test("an origin is found by its alias, and by nothing else", () => {
  assert.equal(siteForOrigin("https://txasm.org/path")?.id, "txasm");
  assert.equal(siteForOrigin("https://example.com"), undefined);
});
