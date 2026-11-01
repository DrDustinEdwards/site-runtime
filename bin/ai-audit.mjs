#!/usr/bin/env node
/**
 * The AI and MCP check against a live origin, for the family's scoreboard (devkit live/, area 11):
 *
 *   site-runtime-ai-audit --origin https://mcp.example.com [--from https://preview.example.workers.dev] [--kind worker]
 *     [--grant-env NAME] [--grant-path /PATH] [--tools-hash HEX] [--conformance-baseline SCENARIO=PASSED/TOTAL ...] [--no-conformance]
 *     [--prose /path ...] [--prose-model ID] [--models]
 *
 * `--kind` is the site's kind in devkit's live/sites.json:
 * a `worker` is an MCP server and must publish its metadata; a `site` or `static` origin is an MCP server only when it
 * does. Without it, the metadata probes decide: an origin whose /.well-known/oauth-protected-resource[/mcp] answers JSON is an MCP server,
 * one that answers 404 on both is not, and any other answer (a 5xx, an HTML page, a redirect) is an A1 error, since a
 * server whose metadata broke must not read as a site that has none. An MCP server gets the door probes:
 *
 *   A1   the resource metadata names the resource, an authorization server and a read scope; no offline_access or wildcard
 *   A2   POST to the endpoint with no token: 401 with resource_metadata= and scope= in WWW-Authenticate
 *   A4   the authorization server metadata: exact issuer, S256 only, CIMD on, RFC 9207 iss on
 *   A8   /authorize with garbage parameters is never cacheable (no-store); framing is another area's check
 *   P10  a foreign Origin with no token: 403 (a 401 means the token check ran before the Origin check)
 *   P5   GET on the endpoint: 405 (or 401, auth first); 200 is a warning, and no Mcp-Session-Id on a modern answer
 *   S8   GET /health: 200; L8 its `tool-call-log` check (./audit-log `auditLogCheck`) passes
 *   P3, P4, P7  the official conformance suite (@modelcontextprotocol/conformance, pinned below, run through npx): the
 *        authorization server's metadata scenario always, and the server scenarios server-stateless,
 *        http-header-validation and caching with the test grant. A scenario that does not pass every check is an error,
 *        unless `--conformance-baseline` records its known count (devkit-conformance's rule: fewer is an error, more is a
 *        warning to tighten the baseline). `--no-conformance` skips it all.
 *
 * WITH A TEST GRANT. The bearer is read from the environment variable `--grant-env` names (default
 * MCP_TEST_GRANT_<HOST>, the origin's host upper-cased with every other character an underscore, so
 * MCP_TEST_GRANT_MCP_EXAMPLE_COM), never from an argument, and is never printed. Make it a READ-ONLY grant (an agent
 * key without AGENT_WRITE): the daily run needs nothing more, and T7 counts on it. Without one, every check below is
 * skipped with a warning that names the variable, never silently. The grant goes to the resource endpoint, or to
 * `--grant-path` on the origin for a server whose agent keys have a door of their own (Capsid's /ops/mcp, which takes
 * keys while /mcp takes OAuth tokens only):
 *
 *   T1-T4, T9  tools/list judged by ./mcp-server `toolListProblems`, the same rules a server's own test runs
 *   T7   two lists in a row are identical, and the read-only grant sees no tool without readOnlyHint
 *   T12  the list's `toolListHash` equals `--tools-hash`; without one, a warning gives the live hash to pin
 *   S1   last, a burst of MCP_PER_MINUTE + 5 concurrent tools/list as the test grant gets at least one 429 (a minute of
 *        refusals for the test grant alone, nobody else's limit). The conformance scenarios and the burst each wait 61 s
 *        first, so one never runs into the window the last one used.
 *
 * Any origin: `--prose /path` (repeatable) fetches a public page that carries AI-written text and runs ./prose
 * `checkProse` over its text, as written by `--prose-model` (default Claude): what a chatbot leaves in text (a refusal,
 * a cutoff note, a blank, citation markup) is a W3 error; another high finding is a W1 warning. `--models` (C8) reads
 * Anthropic's deprecations page and fails on any model in ./anthropic `MODEL_IDS` that is deprecated, retiring within
 * 60 days, or that MODELS describes otherwise than the page. A site with neither has nothing more for this check.
 *
 * --from fetches from another host (a preview) while the expected values (issuer, resource) stay those of --origin.
 * Each finding is a GitHub annotation, `::error title=<item>::<the URL requested> <detail>`, with `%`, CR and LF escaped
 * as GitHub's workflow commands require, so a value from the audited origin cannot start a command of its own. Exits 0
 * clean, 1 on any error, 2 when the origin does not answer at all, so an outage never reads as findings or as a pass.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

import { DEPRECATIONS_URL, MODEL_IDS, deprecationProblems, parseDeprecations } from "../anthropic.mjs";
import { MCP_PER_MINUTE, toolListHash, toolListProblems } from "../mcp-server.mjs";
import { checkProse } from "../prose.mjs";

const TIMEOUT_MS = 10_000;
const VERSION = "2026-07-28";
const DISCOVER = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "server/discover",
  params: { _meta: { "io.modelcontextprotocol/protocolVersion": VERSION, "io.modelcontextprotocol/clientCapabilities": {} } },
});
const MCP_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  "mcp-protocol-version": VERSION,
  "mcp-method": "server/discover",
};
// The suite, pinned exactly (devkit-conformance's version), and the scenarios a production server can pass as it is.
const CONFORMANCE = "@modelcontextprotocol/conformance@0.2.0-alpha.10";
const SERVER_SCENARIOS = ["server-stateless", "http-header-validation", "caching"];
const WINDOW_MS = 61_000;

const { values } = parseArgs({
  options: {
    origin: { type: "string" },
    from: { type: "string" },
    kind: { type: "string" },
    "grant-env": { type: "string" },
    "grant-path": { type: "string" },
    "tools-hash": { type: "string" },
    "conformance-baseline": { type: "string", multiple: true },
    "no-conformance": { type: "boolean" },
    prose: { type: "string", multiple: true },
    "prose-model": { type: "string" },
    models: { type: "boolean" },
  },
});
/** @type {Map<string, { passed: number, total: number }>} */
const baselines = new Map();
for (const entry of values["conformance-baseline"] ?? []) {
  const m = /^([a-z0-9-]+)=(\d+)\/(\d+)$/.exec(entry);
  if (!m) values.origin = undefined;
  else baselines.set(m[1], { passed: Number(m[2]), total: Number(m[3]) });
}
if (!values.origin || (values.kind !== undefined && !["worker", "site", "static"].includes(values.kind)) || (values.prose ?? []).some((p) => !p.startsWith("/")) || (values["grant-path"] !== undefined && !/^\/[A-Za-z0-9/._-]*$/.test(values["grant-path"]))) {
  console.error(
    "usage: site-runtime-ai-audit --origin https://example.com [--from https://preview.example] [--kind worker|site|static] [--grant-env NAME] [--grant-path /PATH] " +
      "[--tools-hash HEX] [--conformance-baseline scenario=passed/total ...] [--no-conformance] [--prose /path ...] [--prose-model ID] [--models]",
  );
  process.exit(2);
}
const origin = values.origin.replace(/\/$/, "");
const from = values.from?.replace(/\/$/, "");
const grantEnv = values["grant-env"] ?? `MCP_TEST_GRANT_${new URL(origin).hostname.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;

/** @type {{ severity: "error" | "warning", item: string, url: string, detail: string }[]} */
const findings = [];
const report = (/** @type {"error" | "warning"} */ severity, /** @type {string} */ item, /** @type {string} */ url, /** @type {string} */ detail) =>
  findings.push({ severity, item, url, detail });

/**
 * One request, never followed, with the 10 s timeout; an URL on --origin goes to --from when given. Returns the URL
 * actually requested (the proof) and the response, or the reason there was none.
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<{ url: string, res: Response | null, why: string }>}
 */
async function get(url, init = {}) {
  const requested = from && url.startsWith(origin) ? from + url.slice(origin.length) : url;
  try {
    const res = await fetch(requested, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...init,
      headers: { "user-agent": "site-runtime-ai-audit", ...init.headers },
    });
    return { url: requested, res, why: "" };
  } catch (error) {
    const why = error instanceof Error && error.name === "TimeoutError" ? `no answer in ${TIMEOUT_MS / 1000} s` : `could not fetch (${error instanceof Error ? error.message : String(error)})`;
    return { url: requested, res: null, why };
  }
}

/** The body as a JSON object, or null when it is not one. */
async function jsonOf(/** @type {Response} */ res) {
  try {
    const body = await res.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Which kind of origin, and whether it answers at all.
// ---------------------------------------------------------------------------------------------------------------------

const prmProbes = await Promise.all(
  ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"].map((path) => get(origin + path, { headers: { accept: "application/json" } })),
);
if (prmProbes.every((p) => !p.res)) {
  console.error(`site-runtime-ai-audit: ${from ?? origin} did not answer: ${prmProbes[0].why}`);
  process.exit(2);
}
/** @type {{ url: string, prm: Record<string, any> }[]} */
const prms = [];
for (const probe of prmProbes) {
  const prm = probe.res?.ok && /json/i.test(probe.res.headers.get("content-type") ?? "") ? await jsonOf(probe.res) : null;
  // A site may answer anything here (an SPA fallback's 200 page); only a worker, or an origin of unknown kind, must not.
  const mayBeAnything = values.kind === "site" || values.kind === "static";
  if (prm) prms.push({ url: probe.url, prm });
  else if (!mayBeAnything && !probe.res) report("error", "A1", probe.url, probe.why);
  else if (!mayBeAnything && probe.res && probe.res.status !== 404) {
    report("error", "A1", probe.url, `answered ${probe.res.status} ${probe.res.headers.get("content-type") ?? "(no content-type)"}, neither 404 nor a JSON object`);
  }
  await probe.res?.body?.cancel().catch(() => {});
}
if (values.kind === "worker" && prms.length === 0 && findings.length === 0) report("error", "A1", prmProbes[0].url, "a worker (an MCP server) publishes no protected-resource metadata");

if (prms.length > 0) await auditMcp();
if (values.prose?.length) await auditProse(values.prose);
if (values.models) await auditModels();

/** A value in a workflow command, escaped as GitHub requires, so it cannot end the line and start another command. */
const commandValue = (/** @type {string} */ text) => text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
for (const f of findings) console.log(`::${f.severity} title=${f.item}::${commandValue(f.url)} ${commandValue(f.detail)}`);
const errors = findings.filter((f) => f.severity === "error").length;
const kind = prms.length > 0 ? "MCP server" : (values.kind ?? "origin");
console.log(`site-runtime-ai-audit: ${kind} ${origin}; ${errors} error(s), ${findings.length - errors} warning(s).`);
process.exit(errors > 0 ? 1 : 0);

// ---------------------------------------------------------------------------------------------------------------------
// An MCP server.
// ---------------------------------------------------------------------------------------------------------------------

async function auditMcp() {
  // A1, on each metadata document served.
  for (const { url, prm } of prms) {
    if (typeof prm.resource !== "string" || !prm.resource) report("error", "A1", url, "has no resource");
    else if (!prm.resource.startsWith(`${origin}/`) && prm.resource !== origin) report("error", "A1", url, `resource ${prm.resource} is not on ${origin}`);
    if (!Array.isArray(prm.authorization_servers) || prm.authorization_servers.length === 0) report("error", "A1", url, "names no authorization_servers");
    const scopes = Array.isArray(prm.scopes_supported) ? prm.scopes_supported.map(String) : null;
    if (!scopes || scopes.length === 0) report("error", "A1", url, "has no scopes_supported");
    else {
      if (!scopes.some((s) => /read/i.test(s))) report("error", "A1", url, `scopes_supported (${scopes.join(" ")}) lists no read scope`);
      if (scopes.includes("offline_access")) report("error", "A1", url, "scopes_supported lists offline_access");
      const broad = scopes.filter((s) => s.includes("*") || /^(all|admin|full)$/i.test(s));
      if (broad.length > 0) report("error", "A1", url, `scopes_supported has a wildcard or omnibus scope: ${broad.join(" ")}`);
    }
  }
  const prm = prms[0].prm;
  const endpoint = typeof prm.resource === "string" && prm.resource.startsWith(`${origin}/`) ? prm.resource : `${origin}/mcp`;

  // A2 and P5's session rule: a modern request with no token.
  const bare = await get(endpoint, { method: "POST", headers: MCP_HEADERS, body: DISCOVER });
  if (!bare.res) report("error", "A2", bare.url, `POST with no token: ${bare.why}`);
  else if (bare.res.status !== 401) report("error", "A2", bare.url, `POST with no token answered ${bare.res.status}, not 401`);
  else {
    const challenge = bare.res.headers.get("www-authenticate") ?? "";
    if (!/resource_metadata="?[^",\s]+/i.test(challenge)) report("error", "A2", bare.url, `the 401's WWW-Authenticate has no resource_metadata: "${challenge}"`);
    if (!/\bscope="?[^",]+/i.test(challenge)) report("error", "A2", bare.url, `the 401's WWW-Authenticate has no scope: "${challenge}"`);
    if (bare.res.headers.has("mcp-session-id")) report("warning", "P5", bare.url, "a modern request's answer carries Mcp-Session-Id");
  }

  // P10: a foreign Origin, no token.
  const foreign = await get(endpoint, { method: "POST", headers: { ...MCP_HEADERS, origin: "https://evil.example" }, body: DISCOVER });
  if (!foreign.res) report("error", "P10", foreign.url, `POST with Origin https://evil.example: ${foreign.why}`);
  else if (foreign.res.status === 401) report("warning", "P10", foreign.url, "Origin https://evil.example got 401, not 403: the token check runs before the Origin check");
  else if (foreign.res.status !== 403) report("error", "P10", foreign.url, `Origin https://evil.example answered ${foreign.res.status}, not 403`);

  // P5: GET on the endpoint.
  const stream = await get(endpoint, { headers: { accept: "text/event-stream" } });
  if (!stream.res) report("error", "P5", stream.url, `GET: ${stream.why}`);
  else if (stream.res.status === 200) report("warning", "P5", stream.url, "GET answered 200; the modern era answers 405");
  else if (stream.res.status !== 405 && stream.res.status !== 401) report("error", "P5", stream.url, `GET answered ${stream.res.status}, not 405`);
  await stream.res?.body?.cancel();

  // A4: the authorization server's metadata (RFC 8414 path insertion for an issuer with a path).
  const issuer = String(Array.isArray(prm.authorization_servers) && prm.authorization_servers[0] ? prm.authorization_servers[0] : origin);
  /** @type {Record<string, any> | null} */
  let as = null;
  let asUrl = "";
  try {
    const parsed = new URL(issuer);
    const path = parsed.pathname.replace(/\/$/, "");
    asUrl = `${parsed.origin}/.well-known/oauth-authorization-server${path}`;
  } catch {
    report("error", "A4", prms[0].url, `authorization server ${issuer} is not a URL`);
  }
  if (asUrl) {
    const meta = await get(asUrl, { headers: { accept: "application/json" } });
    asUrl = meta.url;
    if (!meta.res) report("error", "A4", meta.url, meta.why);
    else if (!meta.res.ok) report("error", "A4", meta.url, `answered ${meta.res.status}`);
    else if (!(as = await jsonOf(meta.res))) report("error", "A4", meta.url, "is not a JSON object");
  }
  if (as) {
    if (as.issuer !== issuer) report("error", "A4", asUrl, `issuer ${JSON.stringify(as.issuer)} is not exactly ${issuer}`);
    const methods = Array.isArray(as.code_challenge_methods_supported) ? as.code_challenge_methods_supported : [];
    if (!methods.includes("S256")) report("error", "A4", asUrl, "code_challenge_methods_supported does not list S256");
    if (methods.includes("plain")) report("error", "A4", asUrl, "code_challenge_methods_supported lists plain");
    if (as.client_id_metadata_document_supported !== true) report("error", "A4", asUrl, "client_id_metadata_document_supported is not true");
    if (as.authorization_response_iss_parameter_supported !== true) report("error", "A4", asUrl, "authorization_response_iss_parameter_supported is not true");
  }

  // A8: whatever /authorize answers to garbage, it is never stored.
  const authorize = new URL(typeof as?.authorization_endpoint === "string" ? as.authorization_endpoint : `${origin}/authorize`);
  for (const [k, v] of Object.entries({ response_type: "code", client_id: "https://evil.example/client.json", redirect_uri: "https://evil.example/cb", state: "x", code_challenge: "x", code_challenge_method: "S256" })) {
    authorize.searchParams.set(k, v);
  }
  const consent = await get(authorize.href, { headers: { accept: "text/html" } });
  if (!consent.res) report("error", "A8", consent.url, consent.why);
  else if (!/no-store/i.test(consent.res.headers.get("cache-control") ?? "")) {
    report("error", "A8", consent.url, `${consent.res.status} with Cache-Control ${JSON.stringify(consent.res.headers.get("cache-control") ?? "(none)")}, not no-store`);
  }
  await consent.res?.body?.cancel();

  // S8, and L8: the tool-call log's own check on /health.
  const health = await get(`${origin}/health`, { headers: { accept: "application/health+json, application/json" } });
  if (!health.res) report("error", "S8", health.url, health.why);
  else if (health.res.status !== 200) report("error", "S8", health.url, `answered ${health.res.status}, not 200`);
  const checks = health.res?.ok ? (await jsonOf(health.res))?.checks : null;
  const logCheck = Array.isArray(checks) ? checks.find((c) => c?.name === "tool-call-log") : undefined;
  if (!logCheck) report("warning", "L8", health.url, "has no tool-call-log check (site-runtime/audit-log auditLogCheck), so a stopped or spiking log goes unseen");
  else if (logCheck.status !== "pass") report("error", "L8", health.url, `tool-call-log is ${logCheck.status}: ${String(logCheck.detail ?? "").slice(0, 200)}`);
  await health.res?.body?.cancel().catch(() => {});

  if (!values["no-conformance"]) {
    const scenario = "authorization-server-metadata-endpoint";
    judgeConformance(scenario, asUrl || issuer, await runMcpConformance(["authorization", "--url", issuer, "--scenario", scenario, "--spec-version", VERSION]));
  }

  const grant = process.env[grantEnv]?.trim();
  if (!grant) {
    report("warning", "T1", endpoint, `no test grant in ${grantEnv}: tools/list (T1-T4, T7, T9, T12), the conformance server scenarios and the rate-limit burst (S1) did not run`);
    return;
  }
  const keyed = values["grant-path"] ? `${origin}${values["grant-path"]}` : endpoint;
  await auditTools(keyed, grant);
  if (!values["no-conformance"]) {
    const proxy = await grantProxy(keyed, grant);
    try {
      for (const scenario of SERVER_SCENARIOS) {
        await sleep(WINDOW_MS);
        judgeConformance(scenario, keyed, await runMcpConformance(["server", "--url", proxy.url, "--scenario", scenario, "--spec-version", VERSION]));
      }
    } finally {
      proxy.close();
    }
  }
  await sleep(WINDOW_MS);
  await burst(keyed, grant);
}

// ---------------------------------------------------------------------------------------------------------------------
// With the test grant.
// ---------------------------------------------------------------------------------------------------------------------

/** A modern-era request's body: the method, its params, and the per-request envelope. */
function envelope(/** @type {string} */ method, /** @type {Record<string, unknown>} */ params = {}) {
  const meta = {
    "io.modelcontextprotocol/protocolVersion": VERSION,
    "io.modelcontextprotocol/clientInfo": { name: "site-runtime-ai-audit", version: "1" },
    "io.modelcontextprotocol/clientCapabilities": {},
  };
  return JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: meta } });
}

/** The JSON-RPC message of an answer sent as JSON or as one server-sent event. */
async function rpcOf(/** @type {Response} */ res) {
  const text = await res.text().catch(() => "");
  if (!/event-stream/i.test(res.headers.get("content-type") ?? "")) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    try {
      const message = JSON.parse(line.slice(5).trim());
      if (message && ("result" in message || "error" in message)) return message;
    } catch {}
  }
  return null;
}

/** Every page of tools/list as the grant sees it, or the reason there is none. */
async function listTools(/** @type {string} */ endpoint, /** @type {string} */ grant) {
  /** @type {Record<string, any>[]} */
  const tools = [];
  let cursor;
  for (let page = 0; page < 20; page++) {
    const r = await get(endpoint, {
      method: "POST",
      headers: { ...MCP_HEADERS, "mcp-method": "tools/list", authorization: `Bearer ${grant}` },
      body: envelope("tools/list", cursor ? { cursor } : {}),
    });
    if (!r.res) return { url: r.url, tools: null, why: r.why };
    const rpc = r.res.ok ? await rpcOf(r.res) : (await r.res.body?.cancel().catch(() => {}), null);
    if (!Array.isArray(rpc?.result?.tools)) {
      return { url: r.url, tools: null, why: r.res.ok ? `tools/list answered no tools${rpc?.error ? ` (${rpc.error.code})` : ""}` : `the test grant was answered ${r.res.status}` };
    }
    tools.push(...rpc.result.tools);
    cursor = typeof rpc.result.nextCursor === "string" && rpc.result.nextCursor ? rpc.result.nextCursor : undefined;
    if (!cursor) return { url: r.url, tools, why: "" };
  }
  return { url: endpoint, tools: null, why: "tools/list still had a next page after 20" };
}

async function auditTools(/** @type {string} */ endpoint, /** @type {string} */ grant) {
  const first = await listTools(endpoint, grant);
  if (!first.tools) return report("error", "T1", first.url, first.why);
  for (const p of toolListProblems(first.tools)) report(p.severity, p.item, first.url, `${p.tool}: ${p.detail}`);

  const second = await listTools(endpoint, grant);
  const names = (/** @type {Record<string, any>[] | null} */ list) => (list ?? []).map((t) => String(t.name)).join(",");
  if (names(second.tools) !== names(first.tools)) report("error", "T7", first.url, "two tools/list calls in a row listed different tools or a different order");
  const writes = first.tools.filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name);
  if (writes.length) report("error", "T7", first.url, `the read-only test grant lists tools that are not read-only: ${writes.slice(0, 10).join(", ")}`);

  const hash = await toolListHash(first.tools);
  const pinned = values["tools-hash"]?.trim().toLowerCase();
  if (!pinned) report("warning", "T12", first.url, `no --tools-hash pinned; the test grant's list hashes to ${hash}`);
  else if (pinned !== hash) report("error", "T12", first.url, `the tool list changed: it hashes to ${hash}, not the pinned ${pinned}; review the change, then pin the new hash`);
}

/** S1: a concurrent burst over the limit, as the test grant, gets at least one 429. */
async function burst(/** @type {string} */ endpoint, /** @type {string} */ grant) {
  const count = MCP_PER_MINUTE + 5;
  const answers = await Promise.all(
    Array.from({ length: count }, () =>
      get(endpoint, { method: "POST", headers: { ...MCP_HEADERS, "mcp-method": "tools/list", authorization: `Bearer ${grant}` }, body: envelope("tools/list") }),
    ),
  );
  const statuses = answers.map((a) => a.res?.status ?? 0);
  await Promise.all(answers.map((a) => a.res?.body?.cancel().catch(() => {})));
  const limited = answers.filter((a) => a.res?.status === 429);
  if (limited.length === 0) report("error", "S1", endpoint, `${count} concurrent requests by one caller, none refused (statuses ${[...new Set(statuses)].join(", ")})`);
  else if (!limited.every((a) => a.res?.headers.has("retry-after"))) report("warning", "S1", endpoint, "a 429 without Retry-After");
}

/**
 * A local proxy that adds the grant to each request and sends it on to `endpoint`, so the suite (which takes no header)
 * tests the real server and never sees the grant. A localhost Origin the suite sends is dropped, since it names the
 * proxy, not a browser page.
 */
async function grantProxy(/** @type {string} */ endpoint, /** @type {string} */ grant) {
  const target = from && endpoint.startsWith(origin) ? from + endpoint.slice(origin.length) : endpoint;
  const server = createServer(async (req, res) => {
    /** @type {Buffer[]} */
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (["host", "connection", "content-length", "authorization", "accept-encoding"].includes(name) || value === undefined) continue;
      if (name === "origin" && /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(String(value))) continue;
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    headers.set("authorization", `Bearer ${grant}`);
    try {
      const answer = await fetch(target, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
      const out = {};
      answer.headers.forEach((value, name) => {
        if (!["content-encoding", "content-length", "transfer-encoding", "connection"].includes(name)) /** @type {any} */ (out)[name] = value;
      });
      res.writeHead(answer.status, out);
      res.end(Buffer.from(await answer.arrayBuffer()));
    } catch {
      res.writeHead(502).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  const address = /** @type {import("node:net").AddressInfo} */ (server.address());
  return { url: `http://127.0.0.1:${address.port}/mcp`, close: () => server.close() };
}

/** Runs the pinned MCP conformance suite through npx, without the grant in its environment; the printed count, or why there is none. */
function runMcpConformance(/** @type {string[]} */ args) {
  const env = { ...process.env };
  delete env[grantEnv];
  return new Promise((resolve) => {
    let out = "";
    const child = spawn("npx", ["-y", CONFORMANCE, ...args], { env, stdio: ["ignore", "pipe", "pipe"], timeout: 300_000, shell: process.platform === "win32" });
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (error) => resolve({ count: null, failed: [], why: `npx could not start (${error.message})` }));
    child.on("close", () => {
      const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
      const m = /Passed:\s*(\d+)\/(\d+)/.exec(plain);
      const failed = [...new Set([...plain.matchAll(/\[([^\]]+?)\s*\]\s+FAILURE\b/g)].map((f) => f[1].trim()))].slice(0, 5);
      resolve(m ? { count: { passed: Number(m[1]), total: Number(m[2]) }, failed, why: "" } : { count: null, failed, why: plain.trim().split("\n").at(-1)?.slice(0, 200) ?? "no output" });
    });
  });
}

/** One scenario's count against its baseline, devkit-conformance's way. */
function judgeConformance(/** @type {string} */ scenario, /** @type {string} */ url, /** @type {any} */ run) {
  const item = { "server-stateless": "P3", "http-header-validation": "P4", caching: "P7" }[scenario] ?? "A4";
  if (!run.count) return report("warning", item, url, `conformance ${scenario} could not run: ${run.why}`);
  const { passed, total } = run.count;
  const failing = run.failed.length ? ` (failing: ${run.failed.join(", ")})` : "";
  const want = baselines.get(scenario);
  if (!want) {
    if (passed < total) report("error", item, url, `conformance ${scenario} passed ${passed}/${total}${failing}`);
  } else if (total !== want.total) report("warning", item, url, `conformance ${scenario} now has ${total} checks, baseline ${want.total}; re-baseline`);
  else if (passed < want.passed) report("error", item, url, `conformance ${scenario} passed ${passed}/${total}, below its baseline ${want.passed}${failing}`);
  else if (passed > want.passed) report("warning", item, url, `conformance ${scenario} passed ${passed}/${total}, above its baseline ${want.passed}; tighten it`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Any origin: public AI text, and the models.
// ---------------------------------------------------------------------------------------------------------------------

/** A page's readable text: no script, style or markup, block ends as line breaks, the common entities decoded. */
function textOf(/** @type {string} */ html) {
  return html
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/?(?:p|div|li|h[1-6]|br|section|article|blockquote|tr|td|th|dd|dt)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&rsquo;/g, "’")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** W1 and W3: each page's text through checkProse, as the model that wrote it. */
async function auditProse(/** @type {string[]} */ paths) {
  const model = values["prose-model"] ?? "claude";
  for (const path of paths) {
    const page = await get(origin + path, { headers: { accept: "text/html" } });
    if (!page.res) {
      report("error", "W1", page.url, page.why);
      continue;
    }
    if (!page.res.ok) {
      report("error", "W1", page.url, `answered ${page.res.status}`);
      await page.res.body?.cancel().catch(() => {});
      continue;
    }
    for (const issue of checkProse(textOf(await page.res.text()), { model, dashes: "allow" })) {
      if (issue.severity !== "high") continue;
      const leftover = ["leftover", "placeholder", "markup"].includes(issue.check);
      report(leftover ? "error" : "warning", leftover ? "W3" : "W1", page.url, `${issue.message}`.slice(0, 200));
    }
  }
}

/** C8: MODEL_IDS against Anthropic's deprecations page. */
async function auditModels() {
  /** @type {string} */
  let page = "";
  try {
    const res = await fetch(DEPRECATIONS_URL, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": "site-runtime-ai-audit" } });
    page = res.ok ? await res.text() : "";
  } catch {}
  const table = parseDeprecations(page);
  if (Object.keys(table).length === 0) return report("warning", "C8", DEPRECATIONS_URL, "could not read the model table; the models were not checked today");
  for (const problem of deprecationProblems(Object.values(MODEL_IDS), table)) report("error", "C8", DEPRECATIONS_URL, problem);
}
