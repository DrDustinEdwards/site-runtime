import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_REPORT_BYTES, cspViolations, receiveCspReport, summarizeViolation, trimReportUrl } from "../csp-report.mjs";

const URL_ = "https://site.example.com/csp-report";
const legacy = { "csp-report": { "document-uri": "https://site.example.com/page?token=secret", "violated-directive": "script-src", "blocked-uri": "https://evil.example.com/x.js?q=1", "line-number": 3, disposition: "enforce" } };
const modern = [{ type: "csp-violation", body: { documentURL: "https://site.example.com/a?b=c", effectiveDirective: "img-src", blockedURL: "data", disposition: "report" } }, { type: "deprecation", body: {} }];
const post = (body, headers = {}) => new Request(URL_, { method: "POST", headers: { "Content-Type": "application/csp-report", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const collect = () => {
  const lines = [];
  return { lines, log: (l) => lines.push(l) };
};

test("both wire formats are read; other report types are not", () => {
  assert.equal(cspViolations(legacy).length, 1);
  assert.equal(cspViolations(modern).length, 1);
  for (const junk of [null, 1, "x", {}, { "csp-report": 1 }, [{ type: "csp-violation" }]]) assert.deepEqual(cspViolations(junk), []);
});

test("a logged line carries no query string, and keywords are kept", () => {
  assert.equal(trimReportUrl("https://a.example.com/p?q=1#h"), "https://a.example.com/p");
  assert.equal(trimReportUrl("inline"), "inline");
  assert.equal(trimReportUrl(""), undefined);
  const line = summarizeViolation(legacy["csp-report"]);
  assert.deepEqual(line, { event: "csp-violation", directive: "script-src", blocked: "https://evil.example.com/x.js", page: "https://site.example.com/page", source: undefined, line: 3, disposition: "enforce" });
  assert.doesNotMatch(JSON.stringify(line), /secret|q=1/);
});

test("a report is logged once per violation and answered 204, with the site's headers", async () => {
  const { lines, log } = collect();
  const res = await receiveCspReport(post(modern), { log, headers: { "X-Content-Type-Options": "nosniff" } });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].page, "https://site.example.com/a");
});

test("too large, unreadable, limited or empty: still 204, nothing logged", async () => {
  const big = JSON.stringify({ "csp-report": { pad: "x".repeat(MAX_REPORT_BYTES) } });
  const cases = [
    [post(big), {}],
    [post(legacy, { "Content-Length": String(MAX_REPORT_BYTES + 1) }), {}],
    [post("not json"), {}],
    [post(legacy), { allow: async () => false }],
    [new Request(URL_, { method: "POST" }), {}],
  ];
  for (const [request, options] of cases) {
    const { lines, log } = collect();
    const res = await receiveCspReport(request, { ...options, log });
    assert.equal(res.status, 204);
    assert.deepEqual(lines, []);
  }
});

test("at most ten violations are logged from one request", async () => {
  const { lines, log } = collect();
  await receiveCspReport(post(Array.from({ length: 25 }, () => modern[0])), { log });
  assert.equal(lines.length, 10);
});

test("the limiter is asked before the body is read", async () => {
  let asked = 0;
  const { lines, log } = collect();
  await receiveCspReport(post(legacy), { log, allow: () => (asked++, true) });
  assert.equal(asked, 1);
  assert.equal(lines.length, 1);
});

test("other methods are 405; the preflight gets CORS only for the named origin", async () => {
  const get = await receiveCspReport(new Request(URL_));
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("Allow"), "POST, OPTIONS");
  const pre = (origin) => receiveCspReport(new Request(URL_, { method: "OPTIONS", headers: { Origin: origin } }), { allowOrigin: "https://app.example.com" });
  const ok = await pre("https://app.example.com");
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), "https://app.example.com");
  const other = await pre("https://evil.example.com");
  assert.equal(other.headers.get("Access-Control-Allow-Origin"), null);
});

test("an extension's or the browser's own violation is dropped; a new (directive, blocked origin) warns once per isolate", async () => {
  const { lines, log } = collect();
  const warned = [];
  const warn = console.warn;
  console.warn = (line) => warned.push(JSON.parse(line));
  try {
    const report = (blocked, source) => [{ type: "csp-violation", body: { effectiveDirective: "script-src-elem", blockedURL: blocked, sourceFile: source } }];
    for (const noise of ["chrome-extension://abc/x.js", "moz-extension://abc/x.js", "about:blank", "file:///x.js"]) {
      await receiveCspReport(post(report(noise)), { log, allow: () => true });
      await receiveCspReport(post(report("https://new.example.com/a.js", noise)), { log, allow: () => true });
    }
    assert.equal(lines.length, 0);
    await receiveCspReport(post(report("https://new.example.com/a.js")), { log, allow: () => true });
    await receiveCspReport(post(report("https://new.example.com/b.js")), { log, allow: () => true });
    assert.equal(lines.length, 2);
    assert.deepEqual(warned, [{ event: "csp_new_blocked", directive: "script-src-elem", blocked: "https://new.example.com" }]);
  } finally {
    console.warn = warn;
  }
});
