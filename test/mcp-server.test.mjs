// The admin MCP scaffold: the era router sends only legacy traffic to the stateless handler and leaves the body
// readable; the API leg names what is missing and tells a failure from a refusal; the door's limit fails closed and
// can only be lowered; the scope check refuses a write on a read grant.
import assert from "node:assert/strict";
import test from "node:test";

import { ApiLegError, authorizeCall, callApi, checkRateLimit, mcpScopes, routeMcpEra } from "../mcp-server.mjs";

test("routeMcpEra: legacy to stateless, everything else to reject, the body intact for the handler", async () => {
  /** @type {string[]} */
  const seen = [];
  const createMcpHandler = (/** @type {unknown} */ _f, /** @type {{ legacy: string, route: string }} */ o) => async (/** @type {Request} */ r) =>
    new Response(`${o.legacy} ${o.route} ${await r.text()}`);
  const isLegacyRequest = async (/** @type {Request} */ r) => (seen.push(await r.text()), seen.at(-1)?.includes("initialize") ?? false);
  const post = (/** @type {string} */ body) => new Request("https://mcp.example.com/mcp", { method: "POST", body });
  const sdk = { factory: () => null, options: { route: "/mcp" }, createMcpHandler, isLegacyRequest };
  assert.equal(await (await routeMcpEra(post('{"method":"initialize"}'), {}, {}, sdk)).text(), 'stateless /mcp {"method":"initialize"}');
  assert.equal(await (await routeMcpEra(post("{}"), {}, {}, sdk)).text(), "reject /mcp {}");
  assert.equal(await (await routeMcpEra(post('{"method":"initialize"}'), {}, {}, { ...sdk, isLegacyRequest: undefined })).text(), 'reject /mcp {"method":"initialize"}');
  assert.equal(seen.length, 2);
});

test("callApi: unconfigured, unreachable and malformed are ApiLegErrors; a refusal is an answer", async () => {
  const leg = { binding: "SITE", token: "TOKEN", api: "The operator API", userAgent: "sample-mcp/1" };
  const token = "t".repeat(32);
  /** @type {Request[]} */
  const sent = [];
  const site = (/** @type {() => Response} */ answer) => ({ fetch: async (/** @type {string} */ url, /** @type {RequestInit} */ init) => (sent.push(new Request(url, init)), answer()) });
  const kind = (/** @type {Promise<unknown>} */ p) => p.then(() => "ok", (e) => (e instanceof ApiLegError ? `${e.kind}: ${e.message}` : String(e)));

  assert.match(await kind(callApi({ SITE_ORIGIN: "https://site.example.com", TOKEN: token }, leg, "/api")), /^unconfigured: .*the SITE service binding is missing/);
  assert.match(await kind(callApi({ SITE: site(() => Response.json({})), SITE_ORIGIN: "https://site.example.com", TOKEN: "short" }, leg, "/api")), /TOKEN is unset or shorter than 32/);
  const env = { SITE: site(() => new Response("<html>")), SITE_ORIGIN: "https://site.example.com", TOKEN: token };
  assert.match(await kind(callApi(env, leg, "/api")), /^malformed: The operator API returned status 200/);
  assert.match(await kind(callApi({ ...env, SITE: { fetch: async () => { throw new Error("1042"); } } }, leg, "/api")), /^unreachable: The operator API could not be reached: 1042/);

  const refused = await callApi({ ...env, SITE: site(() => Response.json({ ok: false, error: "no" }, { status: 403 })) }, leg, "/api/operator", { json: { tool: "x" } });
  assert.deepEqual(refused, { status: 403, ok: false, body: { ok: false, error: "no" } });
  assert.equal(sent.at(-1)?.headers.get("authorization"), `Bearer ${token}`);
  assert.equal(sent.at(-1)?.method, "POST");
  await callApi({ ...env, SITE: site(() => Response.json({})), TOKEN: undefined }, leg, "/api/health", { anonymous: true });
  assert.equal(sent.at(-1)?.headers.get("authorization"), null);
});

test("checkRateLimit fails closed for the whole window, and a caller can lower the ceiling but never raise it", async () => {
  assert.deepEqual(await checkRateLimit(undefined, "admin:a@example.com"), { allowed: false, retryAfter: 60 });
  /** @type {number[]} */
  const limits = [];
  const ns = { idFromName: (/** @type {string} */ n) => n, get: () => ({ hit: async (/** @type {{ limit: number }[]} */ rules) => (limits.push(rules[0].limit), { ok: true, used: 1, limit: rules[0].limit, retryAfterSeconds: 0 }) }) };
  await checkRateLimit(ns, "register:1.2.3.4", 5);
  await checkRateLimit(ns, "admin:a@example.com", 500);
  assert.deepEqual(limits, [5, 30]);
});

test("authorizeCall: no caller, not the administrator, a malformed agent, and a write on a read grant are refused", () => {
  const scopes = mcpScopes("sample");
  const server = { site: "sample.example.com", scopes };
  const env = { ADMIN_EMAIL: "admin@example.com" };
  const admin = (/** @type {string} */ email, /** @type {string[]} */ s) => /** @type {const} */ ({ kind: "admin", props: { email }, scopes: s });
  assert.match(authorizeCall(env, undefined, scopes.read, server) ?? "", /no caller identity/);
  assert.match(authorizeCall(env, admin("other@example.com", scopes.all), scopes.read, server) ?? "", /does not belong to the administrator of sample\.example\.com/);
  assert.match(authorizeCall(env, { kind: "agent", principal: "Grok!", scopes: scopes.all }, scopes.read, server) ?? "", /malformed/);
  assert.match(authorizeCall(env, admin("Admin@Example.com", [scopes.read]), scopes.write, server) ?? "", /read access only \(sample\.read\).*consent page/);
  assert.match(authorizeCall(env, { kind: "agent", principal: "grok", scopes: [scopes.read] }, scopes.write, server) ?? "", /AGENT_WRITE/);
  assert.equal(authorizeCall(env, admin("admin@example.com", scopes.all), scopes.write, server), null);
});
