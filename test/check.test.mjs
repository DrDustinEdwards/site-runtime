import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSecurityHeaders, failures, parsePolicy } from "../check.mjs";
import { CLOUDFLARE_WEB_ANALYTICS } from "../csp.mjs";
import { STANDARD_SECURITY_HEADERS, applyHeaderSet } from "../headers.mjs";

const GOOD_POLICY = "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; report-uri /csp";
const BEACON = CLOUDFLARE_WEB_ANALYTICS.script.join(" ");

/** The standard set plus a passing policy, with `changes` applied (null deletes). @param {Record<string, string | null>} [changes] */
function response(changes = {}) {
  const headers = new Headers({ "Content-Security-Policy": GOOD_POLICY });
  applyHeaderSet(headers);
  for (const [name, value] of Object.entries(changes)) {
    if (value === null) headers.delete(name);
    else headers.set(name, value);
  }
  return headers;
}
/** Names of the failed checks. @param {Headers} headers @param {Parameters<typeof checkSecurityHeaders>[1]} [options] */
const failed = (headers, options) => failures(checkSecurityHeaders(headers, options)).map((r) => r.name);
/** The one failed check matching `pattern`. */
const failure = (/** @type {Headers} */ headers, /** @type {RegExp} */ pattern, /** @type {any} */ options) => {
  const found = failures(checkSecurityHeaders(headers, options)).filter((r) => pattern.test(r.name));
  assert.equal(found.length, 1, `expected one failure matching ${pattern}, got ${JSON.stringify(failed(headers, options))}`);
  return /** @type {import("../check.mjs").CheckResult} */ (found[0]);
};

test("parsePolicy maps lower-cased directive names to their sources", () => {
  const policy = parsePolicy("  Default-Src 'self'  https://a.example.com ;; SCRIPT-SRC\t'self'; upgrade-insecure-requests; ");
  assert.deepEqual([...policy.keys()], ["default-src", "script-src", "upgrade-insecure-requests"]);
  assert.deepEqual(policy.get("default-src"), ["'self'", "https://a.example.com"]);
  assert.deepEqual(policy.get("script-src"), ["'self'"]);
  assert.deepEqual(policy.get("upgrade-insecure-requests"), []);
  assert.equal(parsePolicy("").size, 0);
});

test("parsePolicy keeps the first of a repeated directive, as browsers do", () => {
  assert.deepEqual(parsePolicy("script-src 'self'; script-src *").get("script-src"), ["'self'"]);
  assert.deepEqual(parsePolicy("script-src 'self'; SCRIPT-SRC *").get("script-src"), ["'self'"]);
});

test("failures keeps only the failed results", () => {
  const results = [{ name: "a", pass: true, detail: "" }, { name: "b", pass: false, detail: "x" }];
  assert.deepEqual(failures(results), [results[1]]);
  assert.deepEqual(failures([]), []);
});

test("a response with the standard set and a sound policy passes every check", () => {
  const results = checkSecurityHeaders(response());
  assert.deepEqual(failures(results), []);
  assert.equal(results.length, Object.keys(STANDARD_SECURITY_HEADERS).length + 9);
});

test("a response with no security headers fails every one, as ABSENT", () => {
  const results = checkSecurityHeaders(new Headers(), { csp: false });
  assert.equal(results.length, Object.keys(STANDARD_SECURITY_HEADERS).length);
  for (const name of Object.keys(STANDARD_SECURITY_HEADERS)) {
    assert.ok(results.some((r) => r.name === `${name} is present` && !r.pass && r.detail === "ABSENT"), name);
  }
});

test("each standard header, removed alone, fails alone", () => {
  for (const name of Object.keys(STANDARD_SECURITY_HEADERS)) assert.deepEqual(failed(response({ [name]: null })), [`${name} is present`]);
});

test("HSTS must last at least as long as the floor says", () => {
  assert.deepEqual(failed(response({ "Strict-Transport-Security": "max-age=63072000" })), []);
  assert.deepEqual(failed(response({ "Strict-Transport-Security": "MAX-AGE=99999999; preload" })), []);
  for (const value of ["max-age=63071999; includeSubDomains", "max-age=31536000", "includeSubDomains", "max-age=abc"]) {
    const result = failure(response({ "Strict-Transport-Security": value }), /Strict-Transport-Security/);
    assert.equal(result.name, "Strict-Transport-Security lasts at least 63072000 seconds");
    assert.match(result.detail, /max-age|includeSubDomains/);
  }
});

test("HSTS against a floor with no max-age wants one year", () => {
  const standard = { "Strict-Transport-Security": "includeSubDomains" };
  const headers = (/** @type {string} */ value) => new Headers({ "Strict-Transport-Security": value });
  assert.equal(checkSecurityHeaders(headers("max-age=31536000"), { standard, csp: false })[0]?.pass, true);
  const short = checkSecurityHeaders(headers("max-age=31535999"), { standard, csp: false })[0];
  assert.equal(short?.pass, false);
  assert.equal(short?.name, "Strict-Transport-Security lasts at least 31536000 seconds");
});

test("Referrer-Policy passes only a strict policy", () => {
  for (const value of ["no-referrer", "same-origin", "strict-origin", "strict-origin-when-cross-origin", " No-Referrer "]) {
    assert.deepEqual(failed(response({ "Referrer-Policy": value })), [], value);
  }
  for (const value of ["unsafe-url", "origin", "no-referrer-when-downgrade", "origin-when-cross-origin"]) {
    assert.match(failure(response({ "Referrer-Policy": value }), /Referrer-Policy/).detail, new RegExp(value), value);
  }
});

test("X-Frame-Options passes deny or sameorigin in any case and nothing else", () => {
  for (const value of ["DENY", "SameOrigin", " deny "]) assert.deepEqual(failed(response({ "X-Frame-Options": value })), [], value);
  for (const value of ["allowall", "allow-from https://example.com", "deny, sameorigin", "xdeny"]) {
    failure(response({ "X-Frame-Options": value }), /X-Frame-Options refuses framing/);
  }
});

test("Permissions-Policy must deny every feature the floor denies, and may deny more", () => {
  const floor = STANDARD_SECURITY_HEADERS["Permissions-Policy"] ?? "";
  assert.deepEqual(failed(response({ "Permissions-Policy": `${floor}, bluetooth=()` })), []);
  assert.deepEqual(failed(response({ "Permissions-Policy": floor.replaceAll(", ", ",").replaceAll("=()", "=( )") })), []);
  const result = failure(response({ "Permissions-Policy": floor.replace("camera=()", "camera=(self)").replace("usb=()", "usb=*") }), /Permissions-Policy/);
  assert.match(result.name, /^Permissions-Policy denies accelerometer, .*camera/);
  assert.match(result.detail, /^allows camera, usb; got /);
});

test("any other standard header must equal the floor, ignoring case and outer space", () => {
  assert.deepEqual(failed(response({ "X-Content-Type-Options": " NoSniff ", "Cross-Origin-Opener-Policy": "SAME-ORIGIN" })), []);
  const result = failure(response({ "Cross-Origin-Opener-Policy": "same-origin-allow-popups" }), /Cross-Origin-Opener-Policy/);
  assert.equal(result.name, 'Cross-Origin-Opener-Policy is "same-origin"');
  assert.equal(result.detail, 'got "same-origin-allow-popups"');
  failure(response({ "X-Permitted-Cross-Domain-Policies": "all" }), /X-Permitted-Cross-Domain-Policies/);
});

test("a site's declared set is the floor instead of the standard", () => {
  const standard = { "X-Frame-Options": "sameorigin" };
  const headers = new Headers({ "X-Frame-Options": "sameorigin" });
  assert.deepEqual(failed(headers, { standard, csp: false }), []);
  assert.equal(checkSecurityHeaders(headers, { standard, csp: false }).length, 1);
});

test("csp false skips the policy checks entirely", () => {
  const headers = response({ "Content-Security-Policy": null });
  assert.deepEqual(failed(headers, { csp: false }), []);
  assert.ok(!checkSecurityHeaders(headers, { csp: false }).some((r) => /Content-Security-Policy|-src|report|scripts/.test(r.name)));
});

test("no policy, or only a Report-Only one, fails as not enforced and grades nothing further", () => {
  const none = checkSecurityHeaders(response({ "Content-Security-Policy": null }));
  assert.deepEqual(failures(none).map((r) => [r.name, r.detail]), [["the Content-Security-Policy is enforced, not only reported", "ABSENT"]]);
  const reportOnly = checkSecurityHeaders(response({ "Content-Security-Policy": null, "Content-Security-Policy-Report-Only": GOOD_POLICY }));
  assert.deepEqual(failures(reportOnly).map((r) => r.detail), ["only a Report-Only policy is sent, which blocks nothing"]);
  assert.equal(none.length, Object.keys(STANDARD_SECURITY_HEADERS).length + 1);
});

test("a policy that governs no scripts fails", () => {
  const result = failure(response({ "Content-Security-Policy": "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; report-uri /r" }), /governs scripts/);
  assert.match(result.detail, /any script runs/);
});

test("scripts: 'unsafe-inline', 'unsafe-eval', a wildcard or a bare scheme fail", () => {
  const withScripts = (/** @type {string} */ sources) => response({ "Content-Security-Policy": GOOD_POLICY.replace("script-src 'self'", `script-src ${sources}`) });
  assert.deepEqual(failed(withScripts("'self' 'unsafe-inline'")), ["scripts: no 'unsafe-inline'"]);
  assert.deepEqual(failed(withScripts("'self' 'unsafe-eval'")), ["scripts: no 'unsafe-eval'"]);
  assert.equal(failure(withScripts("'self' 'unsafe-inline'"), /unsafe-inline/).detail, "script sources: 'self' 'unsafe-inline'");
  assert.equal(failure(withScripts("'self' 'unsafe-eval'"), /unsafe-eval/).detail, "script sources: 'self' 'unsafe-eval'");
  assert.equal(failure(withScripts("'self' * https:"), /wildcard/).detail, "allows * https:");
  for (const broad of ["*", "https:", "HTTP:", "data:", "blob:"]) {
    const result = failure(withScripts(`'self' ${broad}`), /wildcard or bare scheme/);
    assert.equal(result.detail, `allows ${broad}`);
  }
  assert.deepEqual(failed(withScripts("'self' https://js.example.com https://*.example.com")), []);
});

test("scripts: an unsafe keyword fails in any case, since browsers match keywords case-insensitively", () => {
  const withScripts = (/** @type {string} */ sources) => response({ "Content-Security-Policy": GOOD_POLICY.replace("script-src 'self'", `script-src ${sources}`) });
  assert.deepEqual(failed(withScripts("'self' 'UNSAFE-INLINE'")), ["scripts: no 'unsafe-inline'"]);
  assert.deepEqual(failed(withScripts("'self' 'Unsafe-Eval'")), ["scripts: no 'unsafe-eval'"]);
});

test("scripts: a host-source whose host is * fails as a wildcard, with or without scheme, port or path", () => {
  const withScripts = (/** @type {string} */ sources) => response({ "Content-Security-Policy": GOOD_POLICY.replace("script-src 'self'", `script-src ${sources}`) });
  for (const broad of ["https://*", "https://*:443", "*:*", "https://*/js/"]) {
    assert.equal(failure(withScripts(`'self' ${broad}`), /wildcard or bare scheme/).detail, `allows ${broad}`);
  }
  assert.deepEqual(failed(withScripts("'self' https://*.example.com:443/js/ https://js.example.com/*")), []);
});

test("every check is reported, passing or failing: the count does not depend on the verdicts", () => {
  const standard = Object.keys(STANDARD_SECURITY_HEADERS).length;
  const bad = response({
    "Content-Security-Policy": "script-src * 'unsafe-inline' 'unsafe-eval'; object-src 'self'; base-uri *",
    "X-Frame-Options": "allowall",
  });
  const results = checkSecurityHeaders(bad);
  assert.equal(results.length, standard + 9);
  assert.deepEqual(failures(results).map((r) => r.name), [
    "X-Frame-Options refuses framing",
    "scripts: no 'unsafe-inline'",
    "scripts: no 'unsafe-eval'",
    "scripts: no wildcard or bare scheme source",
    "object-src is 'none'",
    "base-uri is 'none' or 'self'",
    "frame-ancestors is set",
    "violations are reported somewhere (report-uri or report-to)",
  ]);
  assert.equal(checkSecurityHeaders(response(), { cloudflareWebAnalytics: true }).length, standard + 11);
  assert.equal(checkSecurityHeaders(response({ "Content-Security-Policy": "object-src 'none'" })).length, standard + 6, "with no scripts directive the three script checks do not run");
});

test("the policy is read only from the enforced header: a sound Report-Only beside a weak enforced one does not help", () => {
  const headers = response({ "Content-Security-Policy": "default-src *; report-uri /r", "Content-Security-Policy-Report-Only": GOOD_POLICY });
  assert.ok(failed(headers).includes("scripts: no wildcard or bare scheme source"));
  assert.ok(failed(headers).includes("base-uri is 'none' or 'self'"));
});

test("without script-src, the scripts and objects checks read default-src", () => {
  assert.deepEqual(failed(response({ "Content-Security-Policy": "default-src 'none'; base-uri 'self'; frame-ancestors 'none'; report-to csp" })), []);
  const loose = response({ "Content-Security-Policy": "default-src 'self' 'unsafe-inline'; base-uri 'self'; frame-ancestors 'none'; report-to csp" });
  assert.deepEqual(failed(loose), ["scripts: no 'unsafe-inline'", "object-src is 'none'"]);
});

test("object-src must be exactly 'none'", () => {
  const cases = [
    ["object-src 'self'", "got 'self'"],
    ["object-src 'none' https://a.example.com", "got 'none' https://a.example.com"],
    ["", "got 'self'"],
  ];
  for (const [objects, detail] of cases) {
    const policy = GOOD_POLICY.replace("object-src 'none'", objects ?? "");
    assert.equal(failure(response({ "Content-Security-Policy": policy }), /object-src/).detail, detail);
  }
  const neither = "script-src 'self'; base-uri 'none'; frame-ancestors 'none'; report-uri /r";
  assert.equal(failure(response({ "Content-Security-Policy": neither }), /object-src/).detail, "got ABSENT");
});

test("base-uri must be 'none' or 'self' and does not fall back to default-src", () => {
  assert.deepEqual(failed(response({ "Content-Security-Policy": GOOD_POLICY.replace("base-uri 'none'", "base-uri 'self'") })), []);
  for (const base of ["base-uri https://a.example.com", "base-uri 'self' https://a.example.com", "base-uri"]) {
    failure(response({ "Content-Security-Policy": GOOD_POLICY.replace("base-uri 'none'", base) }), /base-uri/);
  }
  assert.equal(failure(response({ "Content-Security-Policy": GOOD_POLICY.replace("base-uri 'none'", "base-uri 'self' https://a.example.com") }), /base-uri/).detail, "got 'self' https://a.example.com");
  const absent = failure(response({ "Content-Security-Policy": GOOD_POLICY.replace("base-uri 'none'; ", "") }), /base-uri/);
  assert.match(absent.detail, /does not fall back/);
});

test("frame-ancestors must be present", () => {
  const result = failure(response({ "Content-Security-Policy": GOOD_POLICY.replace("frame-ancestors 'none'; ", "") }), /frame-ancestors is set/);
  assert.equal(result.detail, "ABSENT (it does not fall back to default-src)");
});

test("a policy with no report sink fails; report-uri or report-to passes", () => {
  const result = failure(response({ "Content-Security-Policy": GOOD_POLICY.replace("; report-uri /csp", "") }), /reported somewhere/);
  assert.match(result.detail, /never heard about/);
  assert.deepEqual(failed(response({ "Content-Security-Policy": GOOD_POLICY.replace("report-uri /csp", "report-to csp") })), []);
});

test("with Cloudflare Web Analytics on, the policy must let the beacon run from its path prefix and report", () => {
  const options = { cloudflareWebAnalytics: true };
  const withBeacon = GOOD_POLICY.replace("script-src 'self'", `script-src 'self' ${BEACON}`);
  assert.deepEqual(failed(response({ "Content-Security-Policy": withBeacon }), options), []);
  assert.deepEqual(failed(response({ "Content-Security-Policy": withBeacon }), { cloudflareWebAnalytics: false }), []);

  const fileOnly = GOOD_POLICY.replace("script-src 'self'", "script-src 'self' https://static.cloudflareinsights.com/beacon.min.js");
  const result = failure(response({ "Content-Security-Policy": fileOnly }), /beacon run/, options);
  assert.match(result.detail, /^script-src lacks https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js\/: /);
  assert.equal(failed(response({ "Content-Security-Policy": fileOnly })).length, 0, "the beacon was checked without the option");

  const noConnectSelf = `${withBeacon}; connect-src https://api.example.com https://b.example.com`;
  assert.equal(failure(response({ "Content-Security-Policy": noConnectSelf }), /beacon report/, options).detail, "connect-src is https://api.example.com https://b.example.com");
  const defaultNone = withBeacon.replace("default-src 'self'", "default-src 'none'");
  assert.equal(failure(response({ "Content-Security-Policy": defaultNone }), /beacon report/, options).detail, "connect-src is 'none'");
  const noDefault = withBeacon.replace("default-src 'self'; ", "");
  assert.equal(failure(response({ "Content-Security-Policy": noDefault }), /beacon report/, options).detail, "connect-src is ABSENT");
  assert.deepEqual(failed(response({ "Content-Security-Policy": `${noDefault}; connect-src 'self'` }), options), []);
});

test("the beacon check reads default-src for scripts when script-src is absent", () => {
  const policy = `default-src 'self' ${BEACON}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; report-uri /r`;
  assert.deepEqual(failed(response({ "Content-Security-Policy": policy }), { cloudflareWebAnalytics: true }), []);
  const noScripts = "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; connect-src 'self'; report-uri /r";
  const result = failure(response({ "Content-Security-Policy": noScripts }), /beacon run/, { cloudflareWebAnalytics: true });
  assert.match(result.detail, /beacon\.min\.js and https:/);
});
