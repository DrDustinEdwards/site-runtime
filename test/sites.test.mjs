import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSecurityHeaders, failures } from "../check.mjs";
import { buildContentSecurityPolicy, buildStagedPolicy, generateNonce } from "../csp.mjs";
import { buildSecurityHeaders } from "../headers.mjs";
import { SITES, bsw, capsomer as capsomerEntry, dustinedwardsInfo, siteForOrigin } from "../sites.mjs";
import { staticHeaders } from "../static-site.mjs";

const ENDPOINTS = { "Reporting-Endpoints": 'csp-endpoint="https://example.com/csp-report"' };
/** The opt-ins the policy builder takes; the rest (passkey, inlineStyles, uploads, coep, integrityPolicy) are not the policy's. */
const POLICY_KEYS = new Set(["inlineScripts", "strictDynamic", "cloudflareWebAnalytics", "framedBySameOrigin", "baseUriSelf", "denyUnlisted", "formTargets", "trustedTypes"]);

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
  assert.deepEqual(failures(checkSecurityHeaders(capsomer, { site: "prelum" })).map((r) => r.id).sort(), ["C9", "H3", "H5", "I3"]);
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
