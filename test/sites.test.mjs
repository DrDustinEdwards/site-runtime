import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSecurityHeaders, declined, failures } from "../check.mjs";
import { buildContentSecurityPolicy, buildStagedPolicy, generateNonce } from "../csp.mjs";
import { buildSecurityHeaders } from "../headers.mjs";
import { SITES, bsw, capsomer as capsomerEntry, dustinedwardsInfo, siteForOrigin } from "../sites.mjs";
import { staticHeaders } from "../static-site.mjs";
import { sitesDeviationsSource, sitesValuesSource } from "../update-sites-values.mjs";
import { readFileSync } from "node:fs";
import * as values from "../sites-values.mjs";

const ENDPOINTS = { "Reporting-Endpoints": 'csp-endpoint="https://example.com/csp-report"' };
/** The opt-ins the policy builder takes; the rest (passkey, inlineStyles, uploads, coep, integrityPolicy) are not the policy's. */
const POLICY_KEYS = new Set(["inlineScripts", "strictDynamic", "cloudflareWebAnalytics", "framedBySameOrigin", "embeds", "baseUriSelf", "denyUnlisted", "formTargets", "trustedTypes"]);

/** A rendered site's page: its set, the policy its opt-ins build, and the Report-Only policy carrying what it stages. */
function page(/** @type {import("../sites.mjs").SiteEntry} */ entry) {
  const optIns = Object.entries(entry.optIns ?? {}).filter(([k]) => POLICY_KEYS.has(k));
  const policy = Object.fromEntries(optIns.filter(([, v]) => v.value !== "report-only").map(([k, v]) => [k, v.value]));
  const staged = Object.fromEntries(optIns.filter(([, v]) => v.value === "report-only").map(([k]) => [k, true]));
  if (policy.strictDynamic) policy.nonce = generateNonce();
  const csp = buildContentSecurityPolicy(policy);
  const companion = Object.keys(staged).length > 0 ? buildStagedPolicy(policy, staged) : undefined;
  return new Headers({
    ...buildSecurityHeaders({ site: entry }),
    "Content-Type": "text/html; charset=utf-8",
    [csp.name]: csp.value,
    ...(companion ? { [companion.name]: companion.value } : {}),
    ...ENDPOINTS,
  });
}

test("every entry builds, and a page built from its entry passes the check graded by the same entry", () => {
  // The doors are graded through withMcpHeaders (mcp-server.test.mjs); a static site through the set its _headers is written from.
  for (const entry of SITES.filter((s) => !s.id.endsWith("-mcp"))) {
    const headers = entry.assets?.policy ? new Headers({ ...staticHeaders(entry).set, "Content-Type": "text/html; charset=utf-8" }) : page(entry);
    assert.deepEqual(failures(checkSecurityHeaders(headers, { site: entry.id })), [], entry.id);
  }
});

test("an undeclared deviation fails: an opt-in another site declared, or a gap left out of the entry", () => {
  const capsomer = new Headers({ ...staticHeaders(capsomerEntry).set, "Content-Type": "text/html; charset=utf-8" });
  assert.deepEqual(failures(checkSecurityHeaders(capsomer, { site: "prelum" })).map((r) => r.id).sort(), ["C9", "H3", "H5"]);
  const oneYear = page({ ...dustinedwardsInfo, headers: { ...dustinedwardsInfo.headers } });
  oneYear.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
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

test("sites-values.mjs and sites-deviations.mjs are written from sites.mjs, and every reason is written", () => {
  assert.equal(readFileSync(new URL("../sites-values.mjs", import.meta.url), "utf8"), sitesValuesSource(), "run node update-sites-values.mjs");
  assert.equal(readFileSync(new URL("../sites-deviations.mjs", import.meta.url), "utf8"), sitesDeviationsSource(), "run node update-sites-values.mjs");
  for (const entry of SITES) {
    for (const [name, { reason }] of Object.entries({ ...entry.headers, ...entry.optIns, ...entry.deviations })) assert.ok(reason?.trim().length >= 12, `${entry.id} ${name} gives no reason`);
    const worker = values.siteEntry(entry.id);
    assert.deepEqual(buildSecurityHeaders({ site: worker }), buildSecurityHeaders({ site: entry }), entry.id);
    assert.deepEqual(staticHeaders(worker).file, staticHeaders(entry).file, entry.id);
    for (const id of Object.keys(entry.deviations ?? {})) assert.deepEqual(declined(worker, id), declined(entry, id), `${entry.id} ${id}`);
    // A Worker's own CI check passes the entry it imported; its deviations are still graded as declared.
    if (!entry.assets?.policy && !entry.id.endsWith("-mcp")) {
      const headers = page(worker);
      assert.deepEqual(checkSecurityHeaders(headers, { site: worker }), checkSecurityHeaders(headers, { site: entry.id }), entry.id);
    }
  }
});
