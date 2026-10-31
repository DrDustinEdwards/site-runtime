// The admin MCP scaffold: the era router sends only legacy traffic to the stateless handler and leaves the body
// readable; the API leg names what is missing and tells a failure from a refusal; the door's limit fails closed and
// can only be lowered; the scope check refuses a write on a read grant and a tool with no declared scope; the step-up
// names every scope a call needs; the tool-call wrapper logs before it runs and runs nothing it cannot log; the door
// refuses a foreign Origin and a token for another resource.
import assert from "node:assert/strict";
import test from "node:test";

import {
  ApiLegError,
  audienceRefusal,
  authorizeCall,
  callApi,
  checkRateLimit,
  invokeTool,
  mcpOriginRefusal,
  mcpScopes,
  routeMcpEra,
  toolScope,
  toolScopeChallenge,
  toolsForGrant,
} from "../mcp-server.mjs";

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
  const short = await kind(callApi({ SITE: site(() => Response.json({})), SITE_ORIGIN: "https://site.example.com", TOKEN: "short-secret" }, leg, "/api"));
  assert.match(short, /TOKEN is unset or shorter than 32/);
  assert.doesNotMatch(short, /short-secret/);
  assert.match(await kind(callApi({ SITE: site(() => Response.json({})), TOKEN: token }, leg, "/api")), /SITE_ORIGIN is unset/);
  assert.equal(sent.length, 0);
  const env = { SITE: site(() => new Response("<html>")), SITE_ORIGIN: "https://site.example.com", TOKEN: token };
  assert.match(await kind(callApi(env, leg, "/api")), /^malformed: The operator API returned status 200/);
  assert.equal(await callApi({ ...env, SITE: site(() => new Response("<html>", { status: 502 })) }, leg, "/api").catch((e) => e.status), 502);
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

test("authorizeCall: no caller, not the administrator, a malformed agent, and a write on a read grant are refused; a verified person passes on scope", () => {
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
  // A person the server's door verified is not the administrator, and only the grant's scopes decide.
  assert.equal(authorizeCall(env, { kind: "person", email: "editor@example.com", scopes: scopes.all }, scopes.write, server), null);
  assert.equal(authorizeCall(env, { kind: "agent", principal: "grok-build", scopes: scopes.all }, scopes.read, server), null);
  // PLANT: write access is never inferred from an annotation; a tool that declares no scope never runs.
  const annotated = /** @type {{ scope?: unknown }} */ ({ annotations: { readOnlyHint: true } });
  assert.equal(toolScope(annotated, {}, scopes), null);
  assert.match(authorizeCall(env, admin("admin@example.com", scopes.all), toolScope(annotated, {}, scopes), server) ?? "", /declares no scope/);
  const tools = [{ name: "r", scope: "read" }, { name: "w", scope: scopes.write }, { name: "a", scope: () => "write" }, { name: "none" }];
  assert.deepEqual(toolsForGrant(tools, [scopes.read], scopes).map((t) => t.name), ["r", "a"]);
});

const SERVER = { site: "sample.example.com", scopes: mcpScopes("sample"), name: "sample-mcp", version: "1.0.0" };

/** A TOOL_CALL_LOG that records each row, failing the phases named in `failing`. */
function auditLog(/** @type {string[]} */ failing = []) {
  /** @type {Record<string, any>[]} */
  const rows = [];
  const stub = {
    fetch: async (/** @type {string} */ _url, /** @type {RequestInit} */ init) => {
      const row = JSON.parse(String(init.body));
      if (failing.includes(row.phase)) return new Response(null, { status: 500 });
      rows.push(row);
      return new Response(null, { status: 204 });
    },
  };
  return { rows, TOOL_CALL_LOG: /** @type {any} */ ({ idFromName: () => "id", get: () => stub }) };
}

test("invokeTool: refused, started and finished rows (a throwing handler too), and nothing runs when the started row cannot be written", async () => {
  const caller = /** @type {const} */ ({ kind: "admin", props: { email: "admin@example.com", clientId: "https://client.example.com/meta" }, scopes: [SERVER.scopes.read] });
  const tool = { name: "sample_save", scope: (/** @type {Record<string, unknown>} */ a) => (a.action === "save" ? "write" : "read") };
  let ran = 0;
  const run = async () => (ran++, { content: [{ type: /** @type {const} */ ("text"), text: "done" }] });
  const traceparent = `00-${"4bf92f3577b34da6a3ce929d0e0e4736"}-00f067aa0ba902b7-01`;
  const log = auditLog();
  const env = { ADMIN_EMAIL: "admin@example.com", TOOL_CALL_LOG: log.TOOL_CALL_LOG };

  const refused = await invokeTool(env, SERVER, { caller, tool, args: { action: "save" }, run });
  assert.match(refused.content[0].text, /read access only/);
  assert.equal(ran, 0);
  const read = await invokeTool(env, SERVER, { caller, tool, args: { action: "list" }, meta: { traceparent }, run });
  assert.equal(read.content[0].text, "done");
  assert.deepEqual(log.rows.map((r) => r.phase), ["refused", "started", "finished"]);
  assert.equal(log.rows[1].callId, log.rows[2].callId);
  assert.equal(log.rows[2].correlationId, "4bf92f3577b34da6a3ce929d0e0e4736");
  assert.deepEqual([log.rows[2].clientId, log.rows[2].server], ["https://client.example.com/meta", { name: "sample-mcp", version: "1.0.0" }]);

  // A handler that throws still ends its call in the log.
  await assert.rejects(invokeTool(env, SERVER, { caller, tool, args: { action: "list" }, run: async () => { throw new Error("bug"); } }), /bug/);
  assert.deepEqual(log.rows.slice(-2).map((r) => [r.phase, r.result]), [["started", undefined], ["finished", { isError: true, text: "threw: bug" }]]);

  const broken = auditLog(["started"]);
  const unlogged = await invokeTool({ ...env, TOOL_CALL_LOG: broken.TOOL_CALL_LOG }, SERVER, { caller, tool, args: {}, run });
  assert.match(unlogged.content[0].text, /no tool runs unlogged\. Nothing was sent to sample\.example\.com/);
  assert.equal(ran, 1);
});

test("toolScopeChallenge: a write on a read token names both scopes and is logged; a held scope or no token passes", async () => {
  const log = auditLog();
  const challenge = toolScopeChallenge({ TOOL_CALL_LOG: log.TOOL_CALL_LOG }, SERVER, { name: "sample_save", scope: "write" });
  const request = { params: { name: "sample_save", arguments: {} } };
  const authInfo = (/** @type {string[]} */ scopes) => ({ scopes, clientId: "c", extra: { props: { email: "admin@example.com" } } });
  assert.deepEqual((await challenge({ request, authInfo: authInfo([SERVER.scopes.read]) }))?.scopes, [SERVER.scopes.read, SERVER.scopes.write]);
  assert.equal(await challenge({ request, authInfo: authInfo(SERVER.scopes.all) }), undefined);
  assert.equal(await challenge({ request }), undefined);
  assert.deepEqual(log.rows.map((r) => [r.phase, r.caller, r.tool]), [["scope-challenge", "access:admin@example.com", "sample_save"]]);
});

test("the door: a foreign or null Origin is refused, a missing or listed one passes; another resource's token gets a 401 challenge", () => {
  const post = (/** @type {Record<string, string>} */ headers) => new Request("https://mcp.example.com/mcp", { method: "POST", headers });
  assert.equal(mcpOriginRefusal(post({})), null);
  assert.equal(mcpOriginRefusal(post({ Origin: "https://mcp.example.com" })), null);
  assert.equal(mcpOriginRefusal(post({ Origin: "https://claude.ai" }), ["https://claude.ai"]), null);
  assert.equal(mcpOriginRefusal(post({ Origin: "https://evil.example" }))?.status, 403);
  assert.equal(mcpOriginRefusal(post({ Origin: "null" }))?.status, 403);

  const resource = "https://mcp.example.com/mcp";
  assert.equal(audienceRefusal({ audience: resource }, resource, ["sample.read"]), null);
  const refused = audienceRefusal({ audience: "https://other.example.com/mcp" }, resource, ["sample.read"]);
  assert.equal(refused?.status, 401);
  assert.equal(
    refused?.headers.get("www-authenticate"),
    'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp", scope="sample.read", error="invalid_token", error_description="This token was not issued for this server."',
  );
});

test("withMcpHeaders: every door response, a 404 or the consent page, wears the full set and passes the check; security.txt is answered", async () => {
  const { withMcpHeaders } = await import("../mcp-server.mjs");
  const { checkSecurityHeaders, checkSecurityTxt, failures } = await import("../check.mjs");
  const { foxhoundMcp } = await import("../sites.mjs");
  const { CONSENT_STYLE } = await import("../mcp-login.mjs");
  const door = withMcpHeaders(
    (request) =>
      new URL(request.url).pathname === "/authorize"
        ? new Response(`<style>${CONSENT_STYLE}</style>`, { headers: { "Content-Type": "text/html; charset=utf-8" } })
        : new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } }),
    { site: foxhoundMcp, securityTxt: { contact: "security@example.com", expires: new Date(Date.now() + 200 * 86_400_000) } },
  );
  for (const path of ["/nowhere", "/authorize"]) {
    const res = await door(new Request(`https://example.com${path}`), {}, {});
    assert.deepEqual(failures(checkSecurityHeaders(res.headers, { site: foxhoundMcp })), [], path);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
  }
  const url = "https://example.com/.well-known/security.txt";
  const txt = await door(new Request(url), {}, {});
  const graded = checkSecurityTxt({ url, origin: "https://example.com", status: txt.status, headers: txt.headers, body: await txt.text() });
  assert.deepEqual(graded.filter((r) => !r.pass && !r.notice).map((r) => r.id), []);
});
