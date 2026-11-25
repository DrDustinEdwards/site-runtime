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
 * reported not measured, naming the variable, never silently and never as a pass. The grant goes to the resource endpoint, or to
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

import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

import { auditAuthServer } from "./ai-audit-door.mjs";
import {
  SERVER_SCENARIOS,
  grantProxy,
  judgeConformance,
  runMcpConformance,
} from "./ai-audit-conformance.mjs";
import { auditModels, auditProse } from "./ai-audit-prose.mjs";
import { auditTools, burst, declaredCapabilities } from "./ai-audit-tools.mjs";
import { DISCOVER, MCP_HEADERS, TIMEOUT_MS, VERSION, jsonOf } from "./ai-audit-wire.mjs";
import { errorMessage } from "../log.mjs";

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
if (
  !values.origin ||
  (values.kind !== undefined && !["worker", "site", "static"].includes(values.kind)) ||
  (values.prose ?? []).some((p) => !p.startsWith("/")) ||
  (values["grant-path"] !== undefined && !/^\/[A-Za-z0-9/._-]*$/.test(values["grant-path"]))
) {
  console.error(
    "usage: site-runtime-ai-audit --origin https://example.com [--from https://preview.example] [--kind worker|site|static] [--grant-env NAME] [--grant-path /PATH] " +
      "[--tools-hash HEX] [--conformance-baseline scenario=passed/total ...] [--no-conformance] [--prose /path ...] [--prose-model ID] [--models]",
  );
  process.exit(2);
}
const origin = values.origin.replace(/\/$/, "");
const from = values.from?.replace(/\/$/, "");
const grantEnv =
  values["grant-env"] ??
  `MCP_TEST_GRANT_${new URL(origin).hostname.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;

/** @type {{ severity: "error" | "warning" | "unmeasured", item: string, url: string, detail: string }[]} */
const findings = [];
// "unmeasured": an item this run could not measure (no grant, a tool that could not run, a page that could not be read),
// printed in devkit-live's form, `::notice title=<item>::<url> could not measure: <reason>`, never a pass or a failure.
const report = (
  /** @type {"error" | "warning" | "unmeasured"} */ severity,
  /** @type {string} */ item,
  /** @type {string} */ url,
  /** @type {string} */ detail,
) => findings.push({ severity, item, url, detail });

const ctx = { get, report };

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
    // Headers, not a spread: init.headers may be a Headers object, whose entries a spread drops.
    const headers = new Headers(init.headers);
    if (!headers.has("user-agent")) headers.set("user-agent", "site-runtime-ai-audit");
    const res = await fetch(requested, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...init,
      headers,
    });
    return { url: requested, res, why: "" };
  } catch (error) {
    const why =
      error instanceof Error && error.name === "TimeoutError"
        ? `no answer in ${TIMEOUT_MS / 1000} s`
        : `could not fetch (${errorMessage(error)})`;
    return { url: requested, res: null, why };
  }
}

const prmProbes = await Promise.all(
  ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"].map(
    (path) => get(origin + path, { headers: { accept: "application/json" } }),
  ),
);
if (prmProbes.every((p) => !p.res)) {
  console.error(`site-runtime-ai-audit: ${from ?? origin} did not answer: ${prmProbes[0].why}`);
  process.exit(2);
}
/** @type {{ url: string, prm: Record<string, any> }[]} */
const prms = [];
for (const probe of prmProbes) {
  const prm =
    probe.res?.ok && /json/i.test(probe.res.headers.get("content-type") ?? "")
      ? await jsonOf(probe.res)
      : null;
  // A site may answer anything here (an SPA fallback's 200 page); only a worker, or an origin of unknown kind, must not.
  const mayBeAnything = values.kind === "site" || values.kind === "static";
  if (prm) prms.push({ url: probe.url, prm });
  else if (!mayBeAnything && !probe.res) report("error", "A1", probe.url, probe.why);
  else if (!mayBeAnything && probe.res && probe.res.status !== 404) {
    report(
      "error",
      "A1",
      probe.url,
      `answered ${probe.res.status} ${probe.res.headers.get("content-type") ?? "(no content-type)"}, neither 404 nor a JSON object`,
    );
  }
  await probe.res?.body?.cancel().catch(() => {});
}
if (values.kind === "worker" && prms.length === 0 && findings.length === 0)
  report(
    "error",
    "A1",
    prmProbes[0].url,
    "a worker (an MCP server) publishes no protected-resource metadata",
  );

/** A value in a workflow command, escaped as GitHub requires, so it cannot end the line and start another command. */
const commandValue = (/** @type {string} */ text) =>
  text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

// A check that throws must not take the findings with it, or the board reads "fail, 0 errors" with no cause. The stop is an error finding of its own, after the others.
const stopped = (/** @type {unknown} */ error) => {
  report(
    "unmeasured",
    "audit",
    origin,
    `the audit stopped before it finished, so the rest was not measured: ${error instanceof Error ? (error.stack ?? error.message).split("\n").slice(0, 3).join(" | ") : String(error)}`.slice(
      0,
      600,
    ),
  );
};
for (const event of ["unhandledRejection", "uncaughtException"]) {
  process.on(event, (error) => {
    stopped(error);
    finish();
  });
}
try {
  if (prms.length > 0) await auditMcp();
  if (values.prose?.length) await auditProse(ctx, origin, values.prose, values["prose-model"]);
  if (values.models) await auditModels(ctx);
} catch (error) {
  stopped(error);
}
finish();

function finish() {
  for (const f of findings) {
    const line =
      f.severity === "unmeasured"
        ? `notice title=${f.item}::${commandValue(f.url)} could not measure: ${commandValue(f.detail)}`
        : `${f.severity} title=${f.item}::${commandValue(f.url)} ${commandValue(f.detail)}`;
    console.log(`::${line}`);
  }
  const errors = findings.filter((f) => f.severity === "error").length;
  const unmeasured = findings.filter((f) => f.severity === "unmeasured").length;
  const kind = prms.length > 0 ? "MCP server" : (values.kind ?? "origin");
  console.log(
    `site-runtime-ai-audit: ${kind} ${origin}; ${errors} error(s), ${findings.length - errors - unmeasured} warning(s), ${unmeasured} not measured.`,
  );
  process.exit(errors > 0 ? 1 : unmeasured > 0 ? 3 : 0);
}

async function auditMcp() {
  for (const { url, prm } of prms) {
    if (typeof prm.resource !== "string" || !prm.resource)
      report("error", "A1", url, "has no resource");
    else if (!prm.resource.startsWith(`${origin}/`) && prm.resource !== origin)
      report("error", "A1", url, `resource ${prm.resource} is not on ${origin}`);
    if (!Array.isArray(prm.authorization_servers) || prm.authorization_servers.length === 0)
      report("error", "A1", url, "names no authorization_servers");
    const scopes = Array.isArray(prm.scopes_supported) ? prm.scopes_supported.map(String) : null;
    if (!scopes || scopes.length === 0) report("error", "A1", url, "has no scopes_supported");
    else {
      if (!scopes.some((s) => /read/i.test(s)))
        report("error", "A1", url, `scopes_supported (${scopes.join(" ")}) lists no read scope`);
      if (scopes.includes("offline_access"))
        report("error", "A1", url, "scopes_supported lists offline_access");
      const broad = scopes.filter((s) => s.includes("*") || /^(all|admin|full)$/i.test(s));
      if (broad.length > 0)
        report(
          "error",
          "A1",
          url,
          `scopes_supported has a wildcard or omnibus scope: ${broad.join(" ")}`,
        );
    }
  }
  const prm = prms[0].prm;
  const endpoint =
    typeof prm.resource === "string" && prm.resource.startsWith(`${origin}/`)
      ? prm.resource
      : `${origin}/mcp`;

  // A2 and P5's session rule: a modern request with no token.
  const bare = await get(endpoint, { method: "POST", headers: MCP_HEADERS, body: DISCOVER });
  if (!bare.res) report("error", "A2", bare.url, `POST with no token: ${bare.why}`);
  else if (bare.res.status !== 401)
    report("error", "A2", bare.url, `POST with no token answered ${bare.res.status}, not 401`);
  else {
    const challenge = bare.res.headers.get("www-authenticate") ?? "";
    if (!/resource_metadata="?[^",\s]+/i.test(challenge))
      report(
        "error",
        "A2",
        bare.url,
        `the 401's WWW-Authenticate has no resource_metadata: "${challenge}"`,
      );
    if (!/\bscope="?[^",]+/i.test(challenge))
      report("error", "A2", bare.url, `the 401's WWW-Authenticate has no scope: "${challenge}"`);
    if (bare.res.headers.has("mcp-session-id"))
      report("warning", "P5", bare.url, "a modern request's answer carries Mcp-Session-Id");
  }

  // P10: a foreign Origin, no token.
  const foreign = await get(endpoint, {
    method: "POST",
    headers: { ...MCP_HEADERS, origin: "https://evil.example" },
    body: DISCOVER,
  });
  if (!foreign.res)
    report("error", "P10", foreign.url, `POST with Origin https://evil.example: ${foreign.why}`);
  else if (foreign.res.status === 401)
    report(
      "warning",
      "P10",
      foreign.url,
      "Origin https://evil.example got 401, not 403: the token check runs before the Origin check",
    );
  else if (foreign.res.status !== 403)
    report(
      "error",
      "P10",
      foreign.url,
      `Origin https://evil.example answered ${foreign.res.status}, not 403`,
    );

  // P5: GET on the endpoint.
  const stream = await get(endpoint, { headers: { accept: "text/event-stream" } });
  if (!stream.res) report("error", "P5", stream.url, `GET: ${stream.why}`);
  else if (stream.res.status === 200)
    report("warning", "P5", stream.url, "GET answered 200; the modern era answers 405");
  else if (stream.res.status !== 405 && stream.res.status !== 401)
    report("error", "P5", stream.url, `GET answered ${stream.res.status}, not 405`);
  await stream.res?.body?.cancel();

  const { issuer, asUrl } = await auditAuthServer(ctx, origin, prms[0]);

  // S8, and L8: the tool-call log's own check on /health.
  const health = await get(`${origin}/health`, {
    headers: { accept: "application/health+json, application/json" },
  });
  if (!health.res) report("error", "S8", health.url, health.why);
  else if (health.res.status !== 200)
    report("error", "S8", health.url, `answered ${health.res.status}, not 200`);
  const checks = health.res?.ok ? (await jsonOf(health.res))?.checks : null;
  const logCheck = Array.isArray(checks)
    ? checks.find((c) => c?.name === "tool-call-log")
    : undefined;
  if (!logCheck)
    report(
      "warning",
      "L8",
      health.url,
      "has no tool-call-log check (site-runtime/audit-log auditLogCheck), so a stopped or spiking log goes unseen",
    );
  else if (logCheck.status !== "pass")
    report(
      "error",
      "L8",
      health.url,
      `tool-call-log is ${logCheck.status}: ${String(logCheck.detail ?? "").slice(0, 200)}`,
    );
  await health.res?.body?.cancel().catch(() => {});

  if (!values["no-conformance"]) {
    const scenario = "authorization-server-metadata-endpoint";
    judgeConformance(
      ctx,
      baselines,
      scenario,
      asUrl || issuer,
      await runMcpConformance([
        "authorization",
        "--url",
        issuer,
        "--scenario",
        scenario,
        "--spec-version",
        VERSION,
      ]),
    );
  }

  const grant = process.env[grantEnv]?.trim();
  if (!grant) {
    report(
      "unmeasured",
      "T1",
      endpoint,
      `no test grant in ${grantEnv}: tools/list (T1-T4, T7, T9, T12), the conformance server scenarios and the rate-limit burst (S1) did not run`,
    );
    return;
  }
  const keyed = values["grant-path"] ? `${origin}${values["grant-path"]}` : endpoint;
  await auditTools(ctx, keyed, grant, values["tools-hash"]);
  if (!values["no-conformance"]) {
    const capabilities = await declaredCapabilities(ctx, keyed, grant);
    const proxy = await grantProxy(
      from && keyed.startsWith(origin) ? from + keyed.slice(origin.length) : keyed,
      grant,
    );
    try {
      for (const scenario of SERVER_SCENARIOS) {
        await sleep(WINDOW_MS);
        judgeConformance(
          ctx,
          baselines,
          scenario,
          keyed,
          await runMcpConformance(
            ["server", "--url", proxy.url, "--scenario", scenario, "--spec-version", VERSION],
            capabilities,
          ),
        );
      }
    } finally {
      proxy.close();
    }
  }
  await sleep(WINDOW_MS);
  await burst(ctx, keyed, grant);
}
