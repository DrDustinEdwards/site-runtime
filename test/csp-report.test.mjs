import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_REPORT_BYTES,
  receiveCspReport,
  reportBodies,
  summarizeReport,
  summarizeVital,
  trimReportUrl,
} from "../csp-report.mjs";
import { callerScript, defaultRules, escapedReport, REACT_SCRIPT_STUB } from "../trusted-types.mjs";

const URL_ = "https://site.example.com/csp-report";
const legacy = {
  "csp-report": {
    "document-uri": "https://site.example.com/page?token=secret",
    "violated-directive": "script-src",
    "blocked-uri": "https://evil.example.com/x.js?q=1",
    "line-number": 3,
    disposition: "enforce",
  },
};
const modern = [
  {
    type: "csp-violation",
    body: {
      documentURL: "https://site.example.com/a?b=c",
      effectiveDirective: "img-src",
      blockedURL: "data",
      disposition: "report",
    },
  },
  { type: "deprecation", body: {} },
];
const post = (body, headers = {}) =>
  new Request(URL_, {
    method: "POST",
    headers: { "Content-Type": "application/csp-report", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const collect = () => {
  const lines = [];
  return { lines, log: (l) => lines.push(l) };
};

test("both wire formats are read, with Integrity-Policy's and COEP's reports; other report types are not", () => {
  assert.equal(reportBodies(legacy).length, 1);
  assert.equal(reportBodies(modern).length, 1);
  for (const junk of [null, 1, "x", {}, { "csp-report": 1 }, [{ type: "csp-violation" }]])
    assert.deepEqual(reportBodies(junk), []);
  const integrity = {
    type: "integrity-violation",
    body: {
      documentURL: "https://site.example.com/",
      blockedURL: "https://site.example.com/a.js",
      destination: "script",
      reportOnly: true,
    },
  };
  const coep = {
    type: "coep",
    body: {
      type: "corp",
      blockedURL: "https://cdn.example.com/x.png?q=1",
      destination: "image",
      disposition: "reporting",
    },
  };
  const [first, second] = reportBodies([integrity, coep]).map(({ type, body }) =>
    summarizeReport(body, type),
  );
  assert.deepEqual(first, {
    event: "integrity-violation",
    directive: "blocked-destinations",
    blocked: "https://site.example.com/a.js",
    page: "https://site.example.com/",
    source: undefined,
    line: undefined,
    destination: "script",
    disposition: "report",
  });
  assert.deepEqual(second, {
    event: "coep",
    directive: "corp",
    blocked: "https://cdn.example.com/x.png",
    page: undefined,
    source: undefined,
    line: undefined,
    destination: "image",
    disposition: "report",
  });
});

test("a logged line carries no query string, and keywords are kept", () => {
  assert.equal(trimReportUrl("https://a.example.com/p?q=1#h"), "https://a.example.com/p");
  assert.equal(trimReportUrl("inline"), "inline");
  assert.equal(trimReportUrl(""), undefined);
  const line = summarizeReport(legacy["csp-report"]);
  assert.deepEqual(line, {
    event: "csp-violation",
    directive: "script-src",
    blocked: "https://evil.example.com/x.js",
    page: "https://site.example.com/page",
    source: undefined,
    line: 3,
    disposition: "enforce",
  });
  assert.doesNotMatch(JSON.stringify(line), /secret|q=1/);
  // A Trusted Types report keeps the sink and the column, never the sample's text after "|".
  const types = summarizeReport({
    effectiveDirective: "require-trusted-types-for",
    blockedURL: "trusted-types-sink",
    sample: "Element innerHTML|<p>Dear Jane, your code is 1234",
    columnNumber: 9120,
  });
  assert.equal(types.sink, "Element innerHTML");
  assert.equal(types.column, 9120);
  assert.doesNotMatch(JSON.stringify(types), /Jane|1234/);
  // The INP beacon: rounded timings, the page and script cut to origin and path, anything but INP dropped.
  const vital = summarizeVital({
    name: "INP",
    value: 312.4,
    rating: "poor",
    page: "https://site.example.com/a?token=secret",
    target: "main>button.cap-btn",
    inputDelay: 20.2,
    processingDuration: 250.6,
    presentationDelay: 41.6,
    sourceURL: "https://site.example.com/assets/app.js?v=1",
  });
  assert.equal(vital?.value, 312);
  assert.equal(vital?.page, "https://site.example.com/a");
  assert.equal(vital?.script, "https://site.example.com/assets/app.js");
  assert.equal(vital?.processing, 251);
  assert.doesNotMatch(JSON.stringify(vital), /secret|v=1/);
  assert.equal(summarizeVital({ name: "LCP", value: 1 }), null);
  assert.equal(summarizeVital({ name: "INP", value: "fast" }), null);
});

test("a report is logged once per violation and answered 204, with the site's headers", async () => {
  const { lines, log } = collect();
  const res = await receiveCspReport(post(modern), {
    log,
    headers: { "X-Content-Type-Options": "nosniff" },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].page, "https://site.example.com/a");
  // PLANT: a blocked-uri that starts with https: but is no URL is still answered 204, never thrown.
  const odd = { "csp-report": { "blocked-uri": "https://", "effective-directive": "img-src" } };
  assert.equal((await receiveCspReport(post(odd), { log })).status, 204);
});

test("too large, unreadable, limited or empty: still 204, nothing logged", async () => {
  const big = JSON.stringify({ "csp-report": { pad: "x".repeat(MAX_REPORT_BYTES) } });
  /** @type {Array<[Request, import("../csp-report.mjs").ReceiveOptions]>} */
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
  const pre = (origin) =>
    receiveCspReport(new Request(URL_, { method: "OPTIONS", headers: { Origin: origin } }), {
      allowOrigin: "https://app.example.com",
    });
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
    const report = (blocked, source) => [
      {
        type: "csp-violation",
        body: { effectiveDirective: "script-src-elem", blockedURL: blocked, sourceFile: source },
      },
    ];
    for (const noise of [
      "chrome-extension://abc/x.js",
      "moz-extension://abc/x.js",
      "about:blank",
      "file:///x.js",
    ]) {
      await receiveCspReport(post(report(noise)), { log, allow: () => true });
      await receiveCspReport(post(report("https://new.example.com/a.js", noise)), {
        log,
        allow: () => true,
      });
    }
    assert.equal(lines.length, 0);
    await receiveCspReport(post(report("https://new.example.com/a.js")), {
      log,
      allow: () => true,
    });
    await receiveCspReport(post(report("https://new.example.com/b.js")), {
      log,
      allow: () => true,
    });
    assert.equal(lines.length, 2);
    assert.deepEqual(warned, [
      {
        event: "csp_new_blocked",
        directive: "script-src-elem",
        blocked: "https://new.example.com",
      },
    ]);
  } finally {
    console.warn = warn;
  }
});

test("PLANT: the Trusted Types default policy passes only React's script stub and text, escapes other HTML and reports it as a sink and script, never its text; foreign scripts and script text are refused", () => {
  /** @type {string[]} */
  const reported = [];
  const rules = defaultRules((sink) => reported.push(sink), "https://example.com");
  assert.equal(
    rules.createHTML(REACT_SCRIPT_STUB, "TrustedHTML", "Element innerHTML"),
    REACT_SCRIPT_STUB,
  );
  assert.equal(
    rules.createHTML('<img src=x onerror="alert(1)">', "TrustedHTML", "Element innerHTML"),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
  );
  assert.equal(
    rules.createHTML('{"name":"a \\u003cb\\u003e"}', "TrustedHTML", "Element innerHTML"),
    '{"name":"a \\u003cb\\u003e"}',
  );
  assert.deepEqual(reported, ["Element innerHTML"]);
  assert.equal(rules.createScriptURL("/assets/a.js"), "/assets/a.js");
  assert.equal(
    rules.createScriptURL("https://example.com/assets/a.js"),
    "https://example.com/assets/a.js",
  );
  assert.equal(rules.createScriptURL("https://evil.example/a.js"), null);
  assert.equal(rules.createScriptURL("//evil.example/a.js"), null);
  assert.equal(rules.createScript(), null);

  const stack = [
    "Error",
    "    at report (https://example.com/assets/entry-1.js:1:100)",
    "    at Object.createHTML (https://example.com/assets/entry-1.js:1:200)",
    "    at set (https://example.com/assets/chunk-2.js:3:45)",
  ].join("\n");
  const caller = callerScript(stack);
  assert.deepEqual(caller, { url: "https://example.com/assets/chunk-2.js", line: 3, column: 45 });
  const [{ type, body }] = reportBodies(
    escapedReport("Element innerHTML", "https://example.com/a?q=1", caller),
  );
  assert.deepEqual(summarizeReport(body, type), {
    event: "csp-violation",
    directive: "trusted-types-default-policy",
    blocked: "trusted-types-sink",
    page: "https://example.com/a",
    source: "https://example.com/assets/chunk-2.js",
    line: 3,
    column: 45,
    sink: "Element innerHTML",
    disposition: "report",
  });
});
