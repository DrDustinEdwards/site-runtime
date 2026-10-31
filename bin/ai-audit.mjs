#!/usr/bin/env node
/**
 * The AI and MCP check against a live origin, for the family's scoreboard (devkit live/, area 11):
 *
 *   site-runtime-ai-audit --origin https://mcp.example.com [--from https://preview.example.workers.dev] [--kind worker]
 *
 * It holds no grant, so it makes only unauthenticated requests. `--kind` is the site's kind in devkit's live/sites.json:
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
 *   S8   GET /health: 200
 *
 * Any other origin has nothing more for this check.
 *
 * --from fetches from another host (a preview) while the expected values (issuer, resource) stay those of --origin.
 * Each finding is a GitHub annotation, `::error title=<item>::<the URL requested> <detail>`, with `%`, CR and LF escaped
 * as GitHub's workflow commands require, so a value from the audited origin cannot start a command of its own. Exits 0
 * clean, 1 on any error, 2 when the origin does not answer at all, so an outage never reads as findings or as a pass.
 */

import { parseArgs } from "node:util";

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

const { values } = parseArgs({ options: { origin: { type: "string" }, from: { type: "string" }, kind: { type: "string" } } });
if (!values.origin || (values.kind !== undefined && !["worker", "site", "static"].includes(values.kind))) {
  console.error("usage: site-runtime-ai-audit --origin https://example.com [--from https://preview.example] [--kind worker|site|static]");
  process.exit(2);
}
const origin = values.origin.replace(/\/$/, "");
const from = values.from?.replace(/\/$/, "");

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

  // S8.
  const health = await get(`${origin}/health`);
  if (!health.res) report("error", "S8", health.url, health.why);
  else if (health.res.status !== 200) report("error", "S8", health.url, `answered ${health.res.status}, not 200`);
  await health.res?.body?.cancel();
}
