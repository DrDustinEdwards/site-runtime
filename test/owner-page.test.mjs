// The owner page through loginHandler, as a server mounts it: the Access round trip bound to the browser that started
// it, the session, the grants and the log, and a revoke that only a same-origin form with the session's token makes.
// A real SQLite stands in for the log's Durable Object, a Map for KV and a fake for the provider's grant helpers.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, test } from "node:test";

import { ToolCallLog } from "../audit-log.mjs";
import { isAdminUser, loginHandler } from "../mcp-login.mjs";
import { publicJwk as jwk, sign as idToken } from "./jwt.mjs";

const ORIGIN = "https://wrapper.test";
const TEAM = "https://sample.cloudflareaccess.com";
const ISSUER = `${TEAM}/cdn-cgi/access/sso/oidc/client-id`;
const handler = loginHandler({
  name: "Sample Admin",
  scopes: { read: "s.read", write: "s.write" },
  about: "<p>Sample.</p>",
  admit: isAdminUser,
  audit: { name: "sample-mcp", version: "1.0.0" },
});

function setup() {
  const db = new DatabaseSync(":memory:");
  const sql = {
    exec: (/** @type {string} */ q, /** @type {any[]} */ ...p) => {
      const rows = db.prepare(q).all(...p);
      return { toArray: () => rows };
    },
  };
  const log = new ToolCallLog(/** @type {any} */ ({ storage: { sql } }));
  /** @type {Map<string, string>} */
  const kv = new Map();
  const grants = [
    { id: "g1", clientId: "https://client.example.com/meta", userId: "admin@example.com", scope: ["s.read"], metadata: { client: "<b>Sample</b> Client" }, createdAt: 1_790_000_000 },
  ];
  /** @type {string[]} */
  const revoked = [];
  const env = /** @type {any} */ ({
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_SAAS_CLIENT_ID: "client-id",
    ACCESS_SAAS_CLIENT_SECRET: "client-secret",
    ADMIN_EMAIL: "admin@example.com",
    PUBLIC_ORIGIN: ORIGIN,
    AGENT_KEY_GROK: "k".repeat(43),
    TOOL_CALL_LOG: { idFromName: () => "id", get: () => ({ fetch: (/** @type {string} */ url, /** @type {RequestInit} */ init) => log.fetch(new Request(url, init)) }) },
    OAUTH_KV: {
      get: async (/** @type {string} */ k) => kv.get(k) ?? null,
      put: async (/** @type {string} */ k, /** @type {string} */ v) => void kv.set(k, v),
      delete: async (/** @type {string} */ k) => void kv.delete(k),
    },
    OAUTH_PROVIDER: {
      listUserGrants: async (/** @type {string} */ userId) => ({ items: grants.filter((g) => g.userId === userId && !revoked.includes(g.id)) }),
      revokeGrant: async (/** @type {string} */ id) => void revoked.push(id),
    },
  });
  return { env, kv, revoked, log };
}

const realFetch = globalThis.fetch;
let nonce = "";
beforeEach(() => {
  globalThis.fetch = /** @type {typeof fetch} */ (
    async (input) => {
      if (String(input) === `${ISSUER}/jwks`) return Response.json({ keys: [jwk] });
      return Response.json({ id_token: await idToken({ iss: ISSUER, aud: "client-id", exp: Math.floor(Date.now() / 1000) + 300, nonce, email: "Admin@Example.com" }) });
    }
  );
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** @param {Response} res @param {string} name */
const cookieOf = (res, name) => (res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`)) ?? "").split(";")[0];

/** Signs in through Access; answers the session cookie. @param {any} env */
async function signIn(env) {
  const start = await handler.fetch(new Request(`${ORIGIN}/owner`), env);
  assert.equal(start.status, 303);
  const to = new URL(start.headers.get("location") ?? "");
  assert.equal(to.searchParams.get("redirect_uri"), `${ORIGIN}/callback`);
  const state = to.searchParams.get("state") ?? "";
  nonce = to.searchParams.get("nonce") ?? "";
  const bound = cookieOf(start, "__Host-owner-sign-in");
  const back = await handler.fetch(new Request(`${ORIGIN}/callback?code=c1&state=${state}`, { headers: { cookie: bound } }), env);
  assert.equal(back.status, 303);
  assert.equal(back.headers.get("location"), "/owner");
  return cookieOf(back, "__Host-owner");
}

test("PLANT: a callback without the cookie of the browser that started it is refused", async () => {
  const { env } = setup();
  const start = await handler.fetch(new Request(`${ORIGIN}/owner`), env);
  const state = new URL(start.headers.get("location") ?? "").searchParams.get("state");
  const res = await handler.fetch(new Request(`${ORIGIN}/callback?code=c1&state=${state}`), env);
  assert.equal(res.status, 400);
  assert.equal(cookieOf(res, "__Host-owner"), "");
});

test("the owner sees their grants, the agent keys and the log, and revokes only by the page's own form", async () => {
  const { env, revoked, log } = setup();
  await log.fetch(new Request("https://tool-call-log.invalid/append", { method: "POST", body: JSON.stringify({ callId: "c1", phase: "finished", caller: "agent:grok", tool: "sample_read", result: { isError: false, text: "<script>x</script>" } }) }));
  const session = await signIn(env);

  const pageRes = await handler.fetch(new Request(`${ORIGIN}/owner`, { headers: { cookie: session } }), env);
  assert.equal(pageRes.status, 200);
  const html = await pageRes.text();
  assert.match(html, /&lt;b&gt;Sample&lt;\/b&gt; Client/);
  assert.match(html, /AGENT_KEY_GROK/);
  assert.ok(!html.includes("k".repeat(43)), "a key is never shown");
  assert.match(html, /sample_read/);
  assert.match(html, /&lt;script&gt;/);
  const csrf = /name="csrf" value="([0-9a-f]{64})"/.exec(html)?.[1] ?? "";

  const post = (/** @type {Record<string, string>} */ form, /** @type {string} */ origin) =>
    handler.fetch(new Request(`${ORIGIN}/owner/revoke`, { method: "POST", headers: { cookie: session, origin }, body: new URLSearchParams(form) }), env);
  // PLANT: another site's form, or one without the session's token, revokes nothing.
  assert.equal((await post({ csrf, grant: "g1" }, "https://evil.example.com")).status, 403);
  assert.equal((await post({ csrf: "0".repeat(64), grant: "g1" }, ORIGIN)).status, 403);
  assert.equal((await post({ csrf, grant: "someone-elses" }, ORIGIN)).status, 404);
  assert.deepEqual(revoked, []);

  const done = await post({ csrf, grant: "g1" }, ORIGIN);
  assert.equal(done.status, 303);
  assert.deepEqual(revoked, ["g1"]);
  const rows = /** @type {any} */ (await (await log.fetch(new Request("https://tool-call-log.invalid/recent?limit=1"))).json()).rows;
  assert.equal(rows[0].phase, "revoked");
  assert.equal(rows[0].caller, "access:admin@example.com");
  assert.equal(rows[0].client_id, "https://client.example.com/meta");
});
