/** The official MCP conformance suite, run through npx behind a proxy that holds the test grant, and its checks judged. */

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { stripVTControlCharacters } from "node:util";

import { TIMEOUT_MS } from "./ai-audit-wire.mjs";

/** @import { Ctx } from "./ai-audit-wire.mjs" */

/** The suite, pinned exactly (devkit-conformance's version), and the scenarios a production server can pass as it is. */
const CONFORMANCE = "@modelcontextprotocol/conformance@0.2.0-alpha.10";
export const SERVER_SCENARIOS = ["server-stateless", "http-header-validation", "caching"];

/**
 * A local proxy that adds the grant to each request and sends it on to `target`, so the suite (which takes no header)
 * tests the real server and never sees the grant. A localhost Origin the suite sends is dropped, since it names the
 * proxy, not a browser page.
 */
export async function grantProxy(/** @type {string} */ target, /** @type {string} */ grant) {
  /** @param {import("node:http").IncomingMessage} req @param {import("node:http").ServerResponse} res */
  const proxy = async (req, res) => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (
        ["host", "connection", "content-length", "authorization", "accept-encoding"].includes(
          name,
        ) ||
        value === undefined
      )
        continue;
      if (
        name === "origin" &&
        /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(String(value))
      )
        continue;
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    headers.set("authorization", `Bearer ${grant}`);
    // Streamed, never buffered: a subscriptions/listen answer is an event stream that stays open, so reading it whole
    // held back its first frame (the acknowledgment) until the timeout, and the suite failed SEP-2575's ack and
    // subscription-id checks on every server. The upstream request ends when the suite closes its side.
    const upstream = new AbortController();
    res.on("close", () => upstream.abort());
    try {
      // Read inside the try, so a request stream that fails is a 502 too, not an unhandled rejection.
      /** @type {Buffer[]} */
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const answer = await fetch(target, {
        method: req.method,
        headers,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
        redirect: "manual",
        signal: AbortSignal.any([upstream.signal, AbortSignal.timeout(TIMEOUT_MS)]),
      });
      /** @type {Record<string, string>} */
      const out = {};
      answer.headers.forEach((value, name) => {
        if (
          !["content-encoding", "content-length", "transfer-encoding", "connection"].includes(name)
        )
          out[name] = value;
      });
      res.writeHead(answer.status, out);
      if (!answer.body) return void res.end();
      for await (const chunk of answer.body) res.write(chunk);
      res.end();
    } catch {
      if (res.headersSent) res.destroy();
      else res.writeHead(502).end();
    }
  };
  // proxy catches every failure itself, so the promise it returns never rejects.
  const server = createServer((req, res) => void proxy(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  const address = /** @type {import("node:net").AddressInfo} */ (server.address());
  return { url: `http://127.0.0.1:${address.port}/mcp`, close: () => server.close() };
}

/** What npx may see: its paths, proxy and Node settings, never a job's secrets (its install scripts run with them). */
const NPX_ENV =
  /^(PATH|HOME|USERPROFILE|TMP|TEMP|TMPDIR|SystemRoot|APPDATA|LOCALAPPDATA|ComSpec|PATHEXT|CI|NODE_.*|npm_config_.*|SSL_CERT_.*|(HTTPS?|NO|ALL)_PROXY)$/i;

/**
 * Runs the pinned MCP conformance suite through npx, without the grant in its environment, and reads its checks: the
 * count over the checks that apply, the failing ids, and the ones left out, or why there is none. Two kinds of failure
 * say nothing about the server and are left out (a warning names them): one the suite marks untestable (it needs its
 * own diagnostic tools, which a production server does not ship), and a caching check on a list the server answers
 * -32601 for when its server/discover declares no such capability (SEP-2549; a client must not use an undeclared one).
 * @param {string[]} args
 * @param {Record<string, unknown> | null} [capabilities] the server's declared capabilities, when known
 */
export function runMcpConformance(args, capabilities = null) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => NPX_ENV.test(k)));
  // Read from the checks.json under --output-dir, never stdout: the CLI exits before a pipe drains, so a large
  // tools/list (printed twice by http-header-validation) cut the JSON short.
  const dir = mkdtempSync(join(tmpdir(), "mcp-conformance-"));
  return new Promise((resolve) => {
    let out = "";
    const child = spawn("npx", ["-y", CONFORMANCE, ...args, "--output-dir", dir], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 300_000,
      shell: process.platform === "win32",
    });
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (error) =>
      resolve({
        count: null,
        failed: [],
        skipped: [],
        why: `npx could not start (${error.message})`,
      }),
    );
    child.on("close", () => {
      const why =
        stripVTControlCharacters(out).trim().split("\n").at(-1)?.slice(0, 200) || "no output";
      resolve(readChecks(savedChecks(dir), why, capabilities));
      rmSync(dir, { recursive: true, force: true });
    });
  });
}

/** The checks.json the suite saved for its one scenario (in a timestamped folder under the output dir), or null. */
function savedChecks(/** @type {string} */ dir) {
  try {
    const file = readdirSync(dir, { recursive: true, encoding: "utf8" }).find(
      (f) => basename(f) === "checks.json",
    );
    return file ? JSON.parse(readFileSync(join(dir, file), "utf8")) : null;
  } catch {
    return null;
  }
}

/** The suite's saved checks as a count over the checks that apply, or why there are none. */
function readChecks(
  /** @type {any} */ checks,
  /** @type {string} */ why,
  /** @type {Record<string, unknown> | null} */ capabilities,
) {
  if (!Array.isArray(checks)) return { count: null, failed: [], skipped: [], why };
  const lists = {
    "prompts-list": "prompts",
    "resources-list": "resources",
    "resources-templates-list": "resources",
  };
  const notApplicable = (/** @type {any} */ c) => {
    if (c.details?.untestable === true) return true;
    const list =
      /^sep-2549-(prompts-list|resources-list|resources-templates-list)-caching-hints$/.exec(
        String(c.id),
      )?.[1];
    // The list-only test key may not read a resource (PROBE_METHODS), so its 404 is the door's answer, not a missing hint.
    if (c.id === "sep-2549-resources-read-caching-hints" && c.details?.error?.code === -32601)
      return true;
    return Boolean(
      list &&
      c.details?.error?.code === -32601 &&
      capabilities &&
      !(/** @type {Record<string, string>} */ (lists)[list] in capabilities),
    );
  };
  const judged = checks.filter((c) => c?.status === "SUCCESS" || c?.status === "FAILURE");
  const skipped = [
    ...new Set(
      judged.filter((c) => c.status === "FAILURE" && notApplicable(c)).map((c) => String(c.id)),
    ),
  ];
  const applies = judged.filter((c) => !(c.status === "FAILURE" && notApplicable(c)));
  const failed = [
    ...new Set(applies.filter((c) => c.status === "FAILURE").map((c) => String(c.id))),
  ];
  return {
    count: { passed: applies.filter((c) => c.status === "SUCCESS").length, total: applies.length },
    failed: failed.slice(0, 5),
    skipped,
    why: "",
  };
}

/**
 * One scenario's count against its baseline, devkit-conformance's way.
 * @param {Ctx} ctx
 * @param {Map<string, { passed: number, total: number }>} baselines
 * @param {string} scenario
 * @param {string} url
 * @param {any} run
 */
export function judgeConformance({ report }, baselines, scenario, url, run) {
  const item =
    { "server-stateless": "P3", "http-header-validation": "P4", caching: "P7" }[scenario] ?? "A4";
  if (!run.count)
    return report("unmeasured", item, url, `conformance ${scenario} could not run: ${run.why}`);
  if (run.skipped.length)
    report(
      "warning",
      item,
      url,
      `conformance ${scenario}: ${run.skipped.length} check(s) do not apply here and were left out (${run.skipped.join(", ")})`,
    );
  const { passed, total } = run.count;
  const failing = run.failed.length ? ` (failing: ${run.failed.join(", ")})` : "";
  const want = baselines.get(scenario);
  if (!want) {
    if (passed < total)
      report("error", item, url, `conformance ${scenario} passed ${passed}/${total}${failing}`);
  } else if (total !== want.total)
    report(
      "warning",
      item,
      url,
      `conformance ${scenario} now has ${total} checks, baseline ${want.total}; re-baseline`,
    );
  else if (passed < want.passed)
    report(
      "error",
      item,
      url,
      `conformance ${scenario} passed ${passed}/${total}, below its baseline ${want.passed}${failing}`,
    );
  else if (passed > want.passed)
    report(
      "warning",
      item,
      url,
      `conformance ${scenario} passed ${passed}/${total}, above its baseline ${want.passed}; tighten it`,
    );
}
