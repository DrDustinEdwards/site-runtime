import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildContentSecurityPolicy } from "../csp.mjs";
import { LOGOUT_HEADERS, OWASP_SKIPPED, STANDARD_SECURITY_HEADERS } from "../headers.mjs";
import { runOshpSuite } from "../oshp-suite.mjs";

/**
 * Reads oshp-tests-suite.yml into the shape runOshpSuite takes. Not a YAML parser: it reads only the layout this file
 * has (test cases, their steps' url, and assertions that are strings or `or:` lists), and the test below fails if a
 * refreshed suite reads as fewer cases than it names.
 *
 * @param {string} text
 */
function readSuite(text) {
  /** @type {Array<{ name: string, steps: Array<{ url?: string, assertions: unknown[] }> }>} */
  const testcases = [];
  /** @type {string[] | null} */
  let or = null;
  const unquote = (/** @type {string} */ s) => (/^'.*'$/.test(s) ? s.slice(1, -1).replaceAll("''", "'") : s);
  for (const line of text.split("\n")) {
    const testcase = /^ {2}- name: (.*)$/.exec(line);
    const step = /^ {6}- type: /.test(line);
    const url = /^ {8}url: (.*)$/.exec(line);
    const orStart = /^ {10}- or:$/.test(line);
    const orItem = /^ {14}- (.*)$/.exec(line);
    const item = /^ {10}- (.*)$/.exec(line);
    const steps = testcases.at(-1)?.steps;
    if (testcase) testcases.push({ name: unquote(testcase[1] ?? ""), steps: [] });
    else if (step) steps?.push({ assertions: [] });
    else if (url) Object.assign(steps?.at(-1) ?? {}, { url: unquote(url[1] ?? "") });
    else if (orStart) steps?.at(-1)?.assertions.push({ or: (or = []) });
    else if (orItem && or) or.push(unquote(orItem[1] ?? ""));
    else if (item) {
      or = null;
      steps?.at(-1)?.assertions.push(unquote(item[1] ?? ""));
    }
  }
  return { testcases };
}

const SUITE_TEXT = readFileSync(new URL("../oshp-tests-suite.yml", import.meta.url), "utf8");
const SUITE = readSuite(SUITE_TEXT);
const PAGE_HEADERS = { ...STANDARD_SECURITY_HEADERS, "Content-Security-Policy": buildContentSecurityPolicy({ reportUri: "/csp" }).value };
/** @param {Record<string, string>} headers @param {number} [status] */
const respond = (headers, status = 200) => ({ status, headers: new Headers(headers) });
/** A one-case suite with these assertions on the page. @param {unknown[]} assertions */
const suiteOf = (assertions, url = "{{.target_site}}") => ({ testcases: [{ name: "case", steps: [{ url, assertions }] }] });
/** Whether a one-case suite passes. @param {unknown[]} assertions @param {Record<string, string>} headers */
const passes = (assertions, headers, status = 200) => runOshpSuite(suiteOf(assertions), { page: respond(headers, status) })[0]?.pass;

test("the suite file reads as every test case it names, each with assertions", () => {
  assert.equal(SUITE.testcases.length, (SUITE_TEXT.match(/^ {2}- name: /gm) ?? []).length);
  assert.ok(SUITE.testcases.length >= 15);
  for (const testcase of SUITE.testcases) {
    assert.ok(testcase.steps.length > 0 && testcase.steps.every((s) => s.assertions.length > 0), testcase.name);
  }
});

test("the package's page and logout responses fail exactly the cases for the headers it skips on purpose", () => {
  const results = runOshpSuite(SUITE, { page: respond(PAGE_HEADERS), logout: respond({ ...LOGOUT_HEADERS }) });
  assert.equal(results.length, SUITE.testcases.length);
  const failed = results.filter((r) => !r.pass).map((r) => r.name);
  assert.deepEqual(failed.sort(), ["Cache-Control", "Cross-Origin-Embedder-Policy"]);
  for (const name of failed) assert.ok(name in OWASP_SKIPPED, `${name} fails but is not skipped on purpose`);
});

test("with the standard set alone, the failures are exactly OWASP_SKIPPED", () => {
  const results = runOshpSuite(SUITE, { page: respond({ ...STANDARD_SECURITY_HEADERS }) });
  assert.deepEqual(results.filter((r) => !r.pass).map((r) => r.name).sort(), Object.keys(OWASP_SKIPPED).sort());
});

test("a weakened standard header fails its OSHP case, naming the assertion", () => {
  const results = runOshpSuite(SUITE, { page: respond({ ...PAGE_HEADERS, "X-Frame-Options": "sameorigin" }), logout: respond({ ...LOGOUT_HEADERS }) });
  const frame = results.find((r) => r.name === "X-Frame-Options");
  assert.equal(frame?.pass, false);
  assert.deepEqual(frame?.failed, ['result.headers.X-Frame-Options ShouldBeIn "deny" "DENY"']);
  const unsafe = runOshpSuite(SUITE, { page: respond({ ...PAGE_HEADERS, "Content-Security-Policy": "script-src 'unsafe-inline'" }) });
  assert.equal(unsafe.find((r) => r.name === "Content-Security-Policy")?.pass, false);
});

test("a suite with no test cases is refused", () => {
  for (const suite of [undefined, null, {}, { testcases: [] }, { testcases: "x" }]) {
    assert.throws(() => runOshpSuite(/** @type {any} */ (suite), { page: respond({}) }), /the suite has no test cases/);
  }
});

test("ShouldEqual compares the exact value, and fails on an absent header", () => {
  assert.equal(passes(["result.headers.X-Frame-Options ShouldEqual deny"], { "X-Frame-Options": "deny" }), true);
  assert.equal(passes(["result.headers.X-Frame-Options ShouldEqual deny"], { "X-Frame-Options": "DENY" }), false);
  assert.equal(passes(["result.headers.X-Frame-Options ShouldEqual deny"], {}), false);
  assert.equal(passes(['result.headers.HSTS ShouldEqual "max-age=1; preload"'], { HSTS: "max-age=1; preload" }), true);
  assert.equal(passes(['result.headers.HSTS ShouldEqual "max-age=1; preload"'], { HSTS: "max-age=1" }), false);
  assert.equal(passes([`result.headers.C ShouldEqual '"a","b"'`], { C: '"a","b"' }), true);
});

test("the status code is compared as text", () => {
  assert.equal(passes(["result.statuscode ShouldEqual 200"], {}, 200), true);
  assert.equal(passes(["result.statuscode ShouldEqual 200"], {}, 302), false);
});

test("ShouldNotBeNil and ShouldBeNil test presence", () => {
  assert.equal(passes(["result.headers.A ShouldNotBeNil"], { A: "x" }), true);
  assert.equal(passes(["result.headers.A ShouldNotBeNil"], {}), false);
  assert.equal(passes(["result.headers.Server ShouldBeNil"], {}), true);
  assert.equal(passes(["result.headers.Server ShouldBeNil"], { Server: "nginx" }), false);
});

test("ShouldBeIn passes any listed value, quoted or bare, and fails an absent header", () => {
  const assertion = `result.headers.X ShouldBeIn "deny" 'DENY' sameorigin`;
  for (const value of ["deny", "DENY", "sameorigin"]) assert.equal(passes([assertion], { X: value }), true, value);
  for (const value of ["Deny", "deny DENY", "allowall"]) assert.equal(passes([assertion], { X: value }), false, value);
  assert.equal(passes([assertion], {}), false);
});

test("ShouldContainSubstring and ShouldNotContainSubstring test a substring, and both fail an absent header", () => {
  assert.equal(passes(["result.headers.P ShouldContainSubstring camera=()"], { P: "usb=(), camera=()" }), true);
  assert.equal(passes(["result.headers.P ShouldContainSubstring camera=()"], { P: "camera=(self)" }), false);
  assert.equal(passes(["result.headers.P ShouldContainSubstring camera=()"], {}), false);
  assert.equal(passes(['result.headers.C ShouldNotContainSubstring "unsafe"'], { C: "script-src 'self'" }), true);
  assert.equal(passes(['result.headers.C ShouldNotContainSubstring "unsafe"'], { C: "script-src 'unsafe-eval'" }), false);
  assert.equal(passes(['result.headers.C ShouldNotContainSubstring "unsafe"'], {}), false);
});

test("an or passes when any branch holds, and nested ors are read", () => {
  const or = { or: ["result.headers.A ShouldEqual one", "result.headers.A ShouldEqual two"] };
  assert.equal(passes([or], { A: "one" }), true);
  assert.equal(passes([or], { A: "two" }), true);
  assert.equal(passes([or], { A: "three" }), false);
  assert.equal(passes([{ or: [] }], { A: "one" }), false);
  assert.equal(passes([{ or: ["result.headers.A ShouldEqual x", { or: ["result.headers.A ShouldEqual one"] }] }], { A: "one" }), true);
});

test("every assertion in a case must hold, and each that fails is listed in order", () => {
  const or = { or: ["result.headers.A ShouldEqual x", "result.headers.A ShouldEqual y"] };
  const assertions = ["result.headers.A ShouldNotBeNil", "result.headers.B ShouldNotBeNil", or, "result.headers.C ShouldBeNil"];
  const [result] = runOshpSuite(suiteOf(assertions), { page: respond({ A: "one", C: "set" }) });
  assert.deepEqual(result, { name: "case", pass: false, failed: ["result.headers.B ShouldNotBeNil", JSON.stringify(or), "result.headers.C ShouldBeNil"] });
  assert.deepEqual(runOshpSuite(suiteOf(assertions.slice(0, 1)), { page: respond({ A: "one" }) }), [{ name: "case", pass: true, failed: [] }]);
});

test("a step with no assertions passes", () => {
  assert.deepEqual(runOshpSuite({ testcases: [{ name: "empty", steps: [{ url: "{{.target_site}}" }] }] }, { page: respond({}) }), [{ name: "empty", pass: true, failed: [] }]);
});

test("a step whose url names logout_url is run against the logout response, and fails in full when none is given", () => {
  const assertions = ["result.headers.Clear-Site-Data ShouldNotBeNil", { or: ["result.statuscode ShouldEqual 200"] }];
  const logoutSuite = suiteOf(assertions, "{{.target_site}}/{{.logout_url}}");
  const page = respond({ "Clear-Site-Data": "*" });
  assert.equal(runOshpSuite(logoutSuite, { page, logout: respond({ ...LOGOUT_HEADERS }) })[0]?.pass, true);
  assert.equal(runOshpSuite(logoutSuite, { page: respond({}), logout: respond({ ...LOGOUT_HEADERS }) })[0]?.pass, true, "the page was graded instead of the logout response");
  assert.equal(runOshpSuite(logoutSuite, { page: respond({ ...LOGOUT_HEADERS }), logout: respond({}) })[0]?.pass, false, "the page was graded instead of the logout response");
  assert.deepEqual(runOshpSuite(logoutSuite, { page })[0]?.failed, ["result.headers.Clear-Site-Data ShouldNotBeNil", JSON.stringify(assertions[1])]);
  assert.equal(runOshpSuite(suiteOf(["result.headers.Clear-Site-Data ShouldNotBeNil"]), { page, logout: respond({}) })[0]?.pass, true, "a page step was graded against the logout response");
  assert.equal(runOshpSuite({ testcases: [{ name: "no url", steps: [{ assertions: ["result.headers.A ShouldNotBeNil"] }] }] }, { page: respond({ A: "x" }) })[0]?.pass, true);
});

test("an assertion the runner does not understand throws instead of passing", () => {
  const page = respond({ A: "x" });
  for (const assertion of ["result.headers.A ShouldStartWith x", "result.body ShouldContainSubstring x", "headers.A ShouldNotBeNil", "result.headers.A", "  result.headers.A shouldNotBeNil", "x.result.headers.A ShouldNotBeNil"]) {
    assert.throws(() => runOshpSuite(suiteOf([assertion]), { page }), /unsupported (assertion|operator)/, assertion);
  }
  assert.throws(() => runOshpSuite(suiteOf(["result.headers.A ShouldStartWith x"]), { page }), /unsupported operator ShouldStartWith in: result\.headers\.A ShouldStartWith x/);
  for (const shape of [42, null, { and: [] }, { or: "x" }]) {
    assert.throws(() => runOshpSuite(suiteOf([shape]), { page }), /unsupported assertion shape/, JSON.stringify(shape));
  }
  assert.equal(runOshpSuite(suiteOf(["  result.headers.A ShouldNotBeNil  "]), { page })[0]?.pass, true, "outer space is allowed");
  assert.equal(runOshpSuite(suiteOf(["result.headers.A \t ShouldEqual   x"]), { page })[0]?.pass, true, "any run of space between the parts is allowed");
});
