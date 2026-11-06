// The admin MCP door, against a fake provider that records its options and hands /mcp to the door's API handler with
// the token's props and auth a test sets. PLANT tests are the ones that fail if the guard they name is removed.
import assert from "node:assert/strict";
import test from "node:test";

import { adminMcpWorker } from "../admin-mcp.mjs";
import { mcpScopes } from "../mcp-server.mjs";
import { germomicsMcp } from "../sites.mjs";

const ORIGIN = "https://admin-mcp.example.com";
const SCOPES = mcpScopes("sample");
const SERVER = { site: "sample.example.com", scopes: SCOPES, name: "sample-admin-mcp", version: "1.0.0" };
const KEY = "k".repeat(40);

/** @type {Record<string, any>[]} */
let built = [];
/** @type {{ props?: Record<string, unknown>, auth?: Record<string, unknown> }} */
let token = {};

/** Records its options; /mcp goes to apiHandler with `token`, everything else to defaultHandler. */
class FakeProvider {
  /** @param {Record<string, any>} options */
  constructor(options) {
    this.options = options;
    built.push(options);
  }
  /** @param {Request} request @param {any} env @param {any} ctx */
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname === "/mcp") return this.options.apiHandler.fetch(request, env, { ...ctx, ...token });
    return this.options.defaultHandler.fetch(request, { ...env, OAUTH_PROVIDER: {} }, ctx);
  }
}

function setup(/** @type {Record<string, unknown>} */ options = {}) {
  /** @type {{ request: Request, caller: any }[]} */
  const served = [];
  /** @type {Record<string, any>[]} */
  const rows = [];
  const worker = adminMcpWorker({
    name: "Sample Admin",
    server: SERVER,
    site: germomicsMcp,
    securityTxt: { contact: "security@example.com", expires: "2099-01-01T00:00:00Z" },
    about: "<p>Sample.</p>",
    OAuthProvider: /** @type {any} */ (FakeProvider),
    api: { binding: "SITE", name: "sample" },
    serve: async (request, _env, _ctx, caller) => (served.push({ request, caller }), new Response("served")),
    ...options,
  });
  const env = /** @type {any} */ ({
    PUBLIC_ORIGIN: ORIGIN,
    ADMIN_EMAIL: "admin@example.com",
    OAUTH_KV: { get: async () => null, put: async () => {} },
    SITE: { fetch: async () => new Response(null, { status: 404 }) },
    MCP_RATE_LIMIT: { idFromName: (/** @type {string} */ n) => n, get: () => ({ hit: async () => ({ ok: true, used: 1, limit: 30, retryAfterSeconds: 0 }) }) },
    TOOL_CALL_LOG: {
      idFromName: () => "id",
      get: () => ({ fetch: async (/** @type {string} */ _u, /** @type {RequestInit} */ init) => (rows.push(JSON.parse(String(init.body))), new Response(null, { status: 204 })) }),
    },
  });
  const call = (/** @type {string} */ path, /** @type {RequestInit} */ init = {}, /** @type {string} */ origin = ORIGIN) =>
    worker.fetch(new Request(`${origin}${path}`, { method: "POST", ...init }), env, /** @type {any} */ ({ waitUntil() {} }));
  return { worker, env, served, rows, call };
}

const ADMIN = { props: { email: "Admin@Example.com" }, auth: { token: "t", audience: `${ORIGIN}/mcp`, scope: [SCOPES.read], clientId: "c" } };

test("PLANT DNS rebinding: a foreign Origin or another Host is refused before the token is read; claude.ai passes", async () => {
  token = ADMIN;
  const { served, call } = setup();
  assert.equal((await call("/mcp", { headers: { Origin: "https://evil.example" } })).status, 403);
  assert.equal((await call("/mcp", {}, "https://rebound.example")).status, 403);
  assert.equal(served.length, 0);
  assert.equal(await (await call("/mcp", { headers: { Origin: "https://claude.ai" } })).text(), "served");
});

test("PLANT 12.2 and 12.1: another resource's token and another person's grant reach nothing", async () => {
  const { served, call } = setup();
  token = { ...ADMIN, auth: { ...ADMIN.auth, audience: "https://other.example.com/mcp" } };
  assert.equal((await call("/mcp")).status, 401);
  token = { ...ADMIN, props: { email: "someone@example.com" } };
  assert.equal((await call("/mcp")).status, 403);
  token = { ...ADMIN, auth: { ...ADMIN.auth, scope: undefined } };
  assert.equal((await call("/mcp")).status, 403, "a grant with no scope list is refused, not read as read-only");
  assert.equal(served.length, 0);
});

test("the administrator is served with the grant's scopes, admit is asked again on every request, and the limit holds", async () => {
  token = ADMIN;
  /** @type {string[]} */
  const asked = [];
  const { env, served, rows, call } = setup({ admit: async (/** @type {any} */ _env, /** @type {{ email: string }} */ user) => (asked.push(user.email), true) });
  assert.equal(await (await call("/mcp")).text(), "served");
  assert.deepEqual(asked, ["Admin@Example.com"]);
  assert.equal(served[0].caller.kind, "admin");
  assert.deepEqual(served[0].caller.scopes, [SCOPES.read]);
  assert.equal(served[0].caller.auth.token, "t");
  // Over the limit, or with no limiter bound (it fails closed): 429 and a rate-limited row naming the caller.
  delete env.MCP_RATE_LIMIT;
  assert.equal((await call("/mcp")).status, 429);
  assert.equal(rows.at(-1)?.phase, "rate-limited");
  assert.equal(rows.at(-1)?.caller, "access:Admin@Example.com");
  assert.equal(served.length, 1);
});

test("PLANT agent keys: only a server that turns them on serves one, under the secret's name", async () => {
  token = {};
  const off = setup();
  off.env.AGENT_KEY_GROK = KEY;
  await off.call("/mcp", { headers: { Authorization: `Bearer ${KEY}` } }).catch(() => null);
  assert.equal(off.served.length, 0, "an admin server without agentKeys sent a key to the provider");
  const on = setup({ agentKeys: true });
  on.env.AGENT_KEY_GROK = KEY;
  on.env.AGENT_WRITE = "grok";
  assert.equal(await (await on.call("/mcp", { headers: { Authorization: `Bearer ${KEY}` } })).text(), "served");
  assert.deepEqual(on.served[0].caller, { kind: "agent", principal: "grok", scopes: [SCOPES.read, SCOPES.write] });
});

test("the provider is bound to PUBLIC_ORIGIN/mcp and allows only exact registration callbacks", async () => {
  built = [];
  token = ADMIN;
  const { env, call } = setup();
  env.DCR_REDIRECT_URIS = "https://client.example.com/cb";
  await call("/mcp");
  const options = built.at(-1) ?? {};
  assert.equal(options.resourceMetadata.resource, `${ORIGIN}/mcp`);
  assert.deepEqual(options.requiredScopes, SCOPES.all);
  assert.equal(options.clientRegistrationCallback({ clientMetadata: { redirect_uris: ["https://client.example.com/cb"] } }), undefined);
  assert.equal(options.clientRegistrationCallback({ clientMetadata: { redirect_uris: ["https://client.example.com/cb2"] } }).code, "invalid_redirect_uri");
});

test("not configured is not open: no PUBLIC_ORIGIN serves nothing, /health fails without the site binding, the cron needs its bucket", async () => {
  const { env, worker, call } = setup();
  delete env.PUBLIC_ORIGIN;
  assert.equal((await call("/mcp")).status, 503);
  env.PUBLIC_ORIGIN = ORIGIN;
  // Every server asks the site over its binding (sample-reach): a 404 is up, a 5xx warns.
  const up = await (await call("/health", { method: "GET" })).json();
  assert.equal(up.checks.find((/** @type {{ name: string }} */ c) => c.name === "sample-reach")?.status, "pass");
  env.SITE = { fetch: async () => new Response(null, { status: 503 }) };
  const down = await (await call("/health", { method: "GET" })).json();
  assert.equal(down.checks.find((/** @type {{ name: string }} */ c) => c.name === "sample-reach")?.status, "warn");
  delete env.SITE;
  const health = await call("/health", { method: "GET" });
  assert.equal(health.status, 503);
  const body = await health.json();
  assert.equal(body.checks.find((/** @type {{ name: string }} */ c) => c.name === "sample")?.status, "fail");
  await assert.rejects(worker.scheduled({}, env), /AUDIT_BUCKET/);
});
