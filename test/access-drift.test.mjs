// The access drift check against a fake Cloudflare API: an Allow policy's direct addresses, an Access group (with its
// own exclude) and an email list are read, an excluded address is left out, a domain rule and a Bypass policy count as
// open, and the token goes only in the Authorization header. The site's own list reaches the job hashed, and only
// through Access with a service token.
import assert from "node:assert/strict";
import { test } from "node:test";

import { accessAllowed, accessDrift, accessDriftHashed, adminListResponse, fetchAdminList, parseAdminList } from "../access-drift.mjs";
import { keys, sign } from "./jwt.mjs";

const TOKEN = "sample-token";
/** @type {Record<string, unknown>} */
const API = {
  "/accounts/acc/access/apps": [{ id: "other", name: "Other admin" }, { id: "app1", name: "Sample admin" }],
  "/accounts/acc/access/apps/app1/policies": [
    {
      name: "Admins",
      decision: "allow",
      include: [{ email: { email: "Owner@Example.com" } }, { group: { id: "g1" } }, { email_list: { id: "l1" } }, { email_domain: { domain: "example.org" } }],
      exclude: [{ email: { email: "gone@example.com" } }],
    },
    { id: "p2", name: "Reusable", decision: "allow" },
    { name: "Health", decision: "bypass", include: [{ everyone: {} }] },
    { name: "Robots", decision: "non_identity", include: [{ any_valid_service_token: {} }] },
  ],
  "/accounts/acc/access/policies/p2": { include: [{ email: { email: "reuse@example.com" } }] },
  "/accounts/acc/access/groups/g1": {
    name: "Staff",
    include: [{ email: { email: "staff@example.com" } }, { email: { email: "left@example.com" } }, { group: { id: "g1" } }],
    exclude: [{ email: { email: "left@example.com" } }],
  },
  "/accounts/acc/gateway/lists/l1/items": [[{ value: "listed@example.com" }, { value: "gone@example.com" }]],
};

test("drift lists who Access lets in and the app does not, the reverse, and the rules no list can name", async () => {
  /** @type {string[]} */
  const seen = [];
  const fakeFetch = async (/** @type {string} */ url, /** @type {RequestInit} */ init) => {
    const pathname = new URL(url).pathname.replace("/client/v4", "");
    assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${TOKEN}`);
    assert.doesNotMatch(url, new RegExp(TOKEN));
    seen.push(pathname);
    if (!(pathname in API)) return Response.json({ success: false, errors: [{ message: "not found" }] }, { status: 404 });
    return Response.json({ success: true, result: API[pathname], result_info: { page: 1, total_pages: 1 } });
  };
  const allowed = await accessAllowed({ accountId: "acc", appName: "Sample admin", token: TOKEN, fetch: /** @type {typeof fetch} */ (fakeFetch) });
  assert.deepEqual([...allowed.emails].sort(), ["listed@example.com", "owner@example.com", "reuse@example.com", "staff@example.com"]);
  assert.deepEqual(allowed.open, ['policy "Admins": every address at example.org', 'policy "Health": Bypass lets anyone in']);

  const admins = parseAdminList("owner@example.com, staff@example.com\n# reviewers\nreuse@example.com,listed@example.com\nnew@example.com");
  assert.deepEqual(accessDrift(allowed, admins), { onlyInAccess: [], onlyInApp: ["new@example.com"], open: allowed.open });
  assert.deepEqual(accessDrift({ emails: allowed.emails, open: [] }, admins.slice(0, 4)), { onlyInAccess: [], onlyInApp: [], open: [] });

  await assert.rejects(
    accessAllowed({ accountId: "acc", appName: "Missing", token: TOKEN, fetch: /** @type {typeof fetch} */ (fakeFetch) }),
    /no Access application named "Missing"/,
  );
});

test("the site serves its list hashed to an Access service token only, and the job compares hashes", async () => {
  const env = { ACCESS_TEAM_DOMAIN: "sample.cloudflareaccess.com", ACCESS_AUD: "aud-1" };
  const now = Math.floor(Date.now() / 1000);
  const token = (/** @type {Record<string, unknown>} */ who) => sign({ iss: "https://sample.cloudflareaccess.com", aud: ["aud-1"], iat: now, exp: now + 60, ...who });
  const ask = async (/** @type {Record<string, unknown>} */ who) =>
    adminListResponse(new Request("https://example.com/admin/access-drift", { headers: { "cf-access-jwt-assertion": await token(who) } }), env, {
      admins: ["Owner@example.com", "staff@example.com", "new@example.com"],
      keys,
    });
  assert.equal((await ask({ email: "owner@example.com" })).status, 404, "a person, even an admin, gets nothing");
  assert.equal((await adminListResponse(new Request("https://example.com/admin/access-drift"), env, { admins: ["a@example.com"], keys })).status, 404);
  const answer = await ask({ common_name: "drift.access" });
  assert.equal(answer.headers.get("cache-control"), "no-store");
  const text = await answer.text();
  assert.doesNotMatch(text, /example\.com/, "no address leaves the site");

  /** @type {Headers | undefined} */
  let sent;
  const list = await fetchAdminList("https://example.com/admin/access-drift", {
    clientId: "id.access",
    clientSecret: "sample-secret",
    fetch: /** @type {typeof fetch} */ (async (_url, init) => ((sent = new Headers(init?.headers)), new Response(text))),
  });
  assert.equal(sent?.get("cf-access-client-id"), "id.access");
  const drift = await accessDriftHashed({ emails: new Set(["owner@example.com", "staff@example.com", "extra@example.com"]), open: [] }, list);
  assert.deepEqual(drift, { onlyInAccess: ["extra@example.com"], onlyInAppCount: 1, admins: 3, open: [] });
});
