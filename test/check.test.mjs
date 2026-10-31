import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSecurityHeaders, checkSecurityTxt, failures, parsePolicy } from "../check.mjs";
import { CLOUDFLARE_WEB_ANALYTICS } from "../csp.mjs";
import { STANDARD_SECURITY_HEADERS, applyHeaderSet } from "../headers.mjs";

const GOOD_POLICY = "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; report-uri /csp; report-to csp";
const BEACON = CLOUDFLARE_WEB_ANALYTICS.script.join(" ");

/** The standard set plus a passing policy, with `changes` applied (null deletes). @param {Record<string, string | null>} [changes] */
function response(changes = {}) {
  const headers = new Headers({ "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": GOOD_POLICY, "Reporting-Endpoints": 'csp="https://example.com/csp"' });
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
  assert.deepEqual(failures(checkSecurityHeaders(response())), []);
});

test("a response with no security headers fails every one, as ABSENT", () => {
  const results = checkSecurityHeaders(new Headers({ "Content-Type": "text/html" }), { csp: false });
  for (const name of Object.keys(STANDARD_SECURITY_HEADERS)) {
    assert.ok(results.some((r) => r.name === `${name} is present` && !r.pass && r.detail === "ABSENT"), name);
  }
});

test("each standard header, removed alone, fails alone", () => {
  for (const name of Object.keys(STANDARD_SECURITY_HEADERS)) assert.deepEqual(failed(response({ [name]: null })), [`${name} is present`]);
});

test("HSTS must last at least as long as the floor says, and keep includeSubDomains when the floor has it", () => {
  assert.deepEqual(failed(response({ "Strict-Transport-Security": "MAX-AGE=99999999; includesubdomains; preload" })), []);
  assert.deepEqual(failed(response({ "Strict-Transport-Security": "max-age=63072000" })), ["Strict-Transport-Security covers subdomains"]);
  for (const value of ["max-age=63071999; includeSubDomains", "max-age=31536000; includeSubDomains", "max-age=abc; includeSubDomains"]) {
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

test("Referrer-Policy must equal the declared one: a stricter or looser policy is a drift", () => {
  assert.deepEqual(failed(response({ "Referrer-Policy": " No-Referrer " })), []);
  for (const value of ["same-origin", "strict-origin-when-cross-origin", "unsafe-url", "origin"]) {
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
});

test("csp false skips the policy checks entirely", () => {
  const headers = response({ "Content-Security-Policy": null });
  assert.deepEqual(failed(headers, { csp: false }), []);
  assert.ok(!checkSecurityHeaders(headers, { csp: false }).some((r) => /Content-Security-Policy|-src|report|scripts/.test(r.name)));
});

test("no policy, or only a Report-Only one, fails as not enforced and grades nothing further", () => {
  const none = checkSecurityHeaders(response({ "Content-Security-Policy": null }));
  assert.deepEqual(failures(none).map((r) => [r.name, r.detail]), [["the Content-Security-Policy is enforced, not only reported", "ABSENT"]]);
  assert.ok(!none.some((r) => /-src|somewhere/.test(r.name)));
  const reportOnly = checkSecurityHeaders(response({ "Content-Security-Policy": null, "Content-Security-Policy-Report-Only": GOOD_POLICY }));
  assert.deepEqual(failures(reportOnly).map((r) => r.detail), ["only a Report-Only policy is sent, which blocks nothing"]);
});

test("a policy that governs no scripts fails", () => {
  const result = failure(response({ "Content-Security-Policy": "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; report-uri /r" }), /governs scripts/);
  assert.match(result.detail, /any script runs/);
});

test("scripts: 'unsafe-inline' or 'unsafe-eval' fail in any case, since browsers match keywords case-insensitively", () => {
  const withScripts = (/** @type {string} */ sources) => response({ "Content-Security-Policy": GOOD_POLICY.replace("script-src 'self'", `script-src ${sources}`) });
  assert.equal(failure(withScripts("'self' 'UNSAFE-INLINE'"), /unsafe-inline/).detail, "script sources: 'self' 'UNSAFE-INLINE'");
  assert.deepEqual(failed(withScripts("'self' 'Unsafe-Eval'")), ["scripts: no 'unsafe-eval'"]);
  assert.match(failure(withScripts("'self' https://cdnjs.cloudflare.com"), /JSONP/).detail, /^allows https:\/\/cdnjs\.cloudflare\.com \(\/\/cdnjs/);
});

test("C5: a wildcard host or a network scheme fails in every fetch directive; data: and blob: only where script runs", () => {
  const withSources = (/** @type {string} */ directive, /** @type {string} */ sources) => response({ "Content-Security-Policy": `${GOOD_POLICY}; ${directive} ${sources}` });
  const c5 = (/** @type {Headers} */ headers) => failures(checkSecurityHeaders(headers)).filter((r) => r.id === "C5").map((r) => `${r.name} ${r.detail}`);
  assert.deepEqual(c5(response({ "Content-Security-Policy": GOOD_POLICY.replace("script-src 'self'", "script-src 'self' * https:") })), [
    "script-src: no wildcard or bare scheme source allows * (any host), https: (any host over https:)",
  ]);
  assert.deepEqual(c5(withSources("img-src", "'self' https://*.example.com")), ["img-src: no wildcard or bare scheme source allows https://*.example.com (every subdomain of the host)"]);
  assert.deepEqual(c5(withSources("worker-src", "'self' data:")), ["worker-src: no wildcard or bare scheme source allows data: (script any page can write as data:)"]);
  assert.deepEqual(c5(withSources("img-src", "'self' data: blob: https://img.example.com/*")), []);
});

test("a weak policy fails each rule it breaks, in order", () => {
  const bad = response({
    "Content-Security-Policy": "script-src * 'unsafe-inline' 'unsafe-eval'; object-src 'self'; base-uri *",
    "X-Frame-Options": "allowall",
  });
  assert.deepEqual(failures(checkSecurityHeaders(bad)).map((r) => r.name), [
    "X-Frame-Options refuses framing",
    "scripts: no 'unsafe-inline'",
    "scripts: no 'unsafe-eval'",
    "script-src: no wildcard or bare scheme source",
    "object-src is 'none'",
    "base-uri is 'none' or 'self'",
    "frame-ancestors is 'none' or 'self'",
    "violations are reported to both sinks (report-uri and report-to)",
  ]);
});

test("the policy is read only from the enforced header: a sound Report-Only beside a weak enforced one does not help", () => {
  const headers = response({ "Content-Security-Policy": "default-src *; report-uri /r", "Content-Security-Policy-Report-Only": GOOD_POLICY });
  assert.ok(failed(headers).includes("default-src: no wildcard or bare scheme source"));
  assert.ok(failed(headers).includes("base-uri is 'none' or 'self'"));
});

test("without script-src, the scripts and objects checks read default-src", () => {
  assert.deepEqual(failed(response({ "Content-Security-Policy": "default-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; report-uri /r; report-to csp" })), []);
  const loose = response({ "Content-Security-Policy": "default-src 'self' 'unsafe-inline'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; report-uri /r; report-to csp" });
  assert.deepEqual(failed(loose), ["scripts: no 'unsafe-inline'", "style-src: no 'unsafe-inline'", "object-src is 'none'"]);
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
  const neither = "script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; report-uri /r";
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

test("frame-ancestors must be present and refuse other origins; form-action, when set, too", () => {
  const without = (/** @type {string} */ directive) => response({ "Content-Security-Policy": GOOD_POLICY.replace(new RegExp(`${directive} [^;]*; `), "") });
  assert.equal(failure(without("frame-ancestors"), /frame-ancestors/).detail, "got ABSENT (it does not fall back to default-src)");
  assert.deepEqual(failed(without("form-action")), [], "a consent page leaves form-action out on purpose");
  for (const loose of ["frame-ancestors *", "frame-ancestors https://evil.example", "form-action *", "form-action 'self' https://evil.example"]) {
    const [directive] = loose.split(" ");
    const policy = GOOD_POLICY.replace(new RegExp(`${directive} [^;]*`), loose);
    failure(response({ "Content-Security-Policy": policy }), new RegExp(directive ?? ""));
  }
  assert.deepEqual(failed(response({ "Content-Security-Policy": GOOD_POLICY.replace("frame-ancestors 'none'", "frame-ancestors 'self'") })), []);
});

test("PLANT: form-action may carry the off-site targets the site declared, and only those, after 'self'", () => {
  const stripe = response({ "Content-Security-Policy": GOOD_POLICY.replace("form-action 'self'", "form-action 'self' https://checkout.stripe.com") });
  const declared = { formTargets: ["https://checkout.stripe.com", "https://connect.stripe.com"] };
  assert.deepEqual(failures(checkSecurityHeaders(stripe, declared)).map((r) => r.name), []);
  failure(stripe, /form-action/);
  const other = response({ "Content-Security-Policy": GOOD_POLICY.replace("form-action 'self'", "form-action 'self' https://evil.example") });
  assert.equal(failures(checkSecurityHeaders(other, declared)).length, 1);
  const withoutSelf = response({ "Content-Security-Policy": GOOD_POLICY.replace("form-action 'self'", "form-action https://checkout.stripe.com") });
  assert.equal(failures(checkSecurityHeaders(withoutSelf, declared)).length, 1);
});

test("script-src-elem, script-src-attr and worker-src are held to the script rules", () => {
  for (const directive of ["script-src-elem", "script-src-attr", "worker-src"]) {
    for (const source of ["'unsafe-inline'", "'unsafe-eval'", "*", "https:"]) {
      failure(response({ "Content-Security-Policy": `${GOOD_POLICY}; ${directive} ${source}` }), new RegExp(`^${directive}: `));
    }
  }
  assert.deepEqual(failed(response({ "Content-Security-Policy": `${GOOD_POLICY}; worker-src 'self' blob:` })), []);
});

test("a policy needs both report sinks, and Reporting-Endpoints must name the report-to group", () => {
  assert.match(failure(response({ "Content-Security-Policy": GOOD_POLICY.replace("; report-uri /csp", "") }), /both sinks/).detail, /no report-uri/);
  assert.match(failure(response({ "Content-Security-Policy": GOOD_POLICY.replace("; report-to csp", "") }), /both sinks/).detail, /no report-to/);
  assert.match(failure(response({ "Reporting-Endpoints": null }), /Reporting-Endpoints/).detail, /ABSENT/);
  assert.equal(failure(response({ "Reporting-Endpoints": 'other="https://example.com/csp"' }), /Reporting-Endpoints/).id, "M1");
  assert.equal(failure(response({ "Reporting-Endpoints": 'csp="http://example.com/csp"' }), /Reporting-Endpoints/).id, "M1");
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
  const policy = `default-src 'self' ${BEACON}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; report-uri /r; report-to csp`;
  assert.deepEqual(failed(response({ "Content-Security-Policy": policy }), { cloudflareWebAnalytics: true }), []);
  const noScripts = "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'; report-uri /r";
  const result = failure(response({ "Content-Security-Policy": noScripts }), /beacon run/, { cloudflareWebAnalytics: true });
  assert.match(result.detail, /beacon\.min\.js and https:/);
});

test("a script host known to serve JSONP, AngularJS or Flash fails C5, by csp-evaluator's host-then-path match", () => {
  const grade = (/** @type {string} */ host) =>
    failures(checkSecurityHeaders(response({ "Content-Security-Policy": GOOD_POLICY.replace("script-src 'self'", `script-src 'self' ${host}`) }))).some((r) => r.id === "C5");
  for (const host of ["https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com/ajax/libs/"]) assert.ok(grade(host), host);
  assert.ok(!grade("https://cdnjs.cloudflare.com/ajax/libs/mathjax/"));
  assert.ok(!grade("https://www.googletagmanager.com"), "a bypass that needs 'unsafe-eval' cannot fire here");
});

test("what a site declares is graded: strictDynamic, denyUnlisted, trustedTypes, inlineStyles and integrityPolicy", () => {
  const strict = GOOD_POLICY.replace("default-src 'self'", "default-src 'none'").replace("script-src 'self'", "script-src 'nonce-abc' 'strict-dynamic'");
  const all = { strictDynamic: true, denyUnlisted: true, trustedTypes: /** @type {const} */ (true), integrityPolicy: /** @type {const} */ ("enforce") };
  const sound = response({ "Content-Security-Policy": `${strict}; require-trusted-types-for 'script'`, "Integrity-Policy": "blocked-destinations=(script)" });
  assert.deepEqual(failed(sound, all), []);
  assert.deepEqual(failures(checkSecurityHeaders(response(), all)).map((r) => r.id), ["S2", "C3", "C9", "C7"]);
  assert.deepEqual(failed(response(), {}), [], "nothing undeclared is graded");
  const styled = response({ "Content-Security-Policy": `${GOOD_POLICY}; style-src 'self' 'unsafe-inline'` });
  assert.equal(failure(styled, /style-src/).id, "C11");
  assert.deepEqual(failed(styled, { inlineStyles: true }), []);
});

test("cookies: a prefix is required unless the entry declines it by name, and a cookie response is never shared-cached", () => {
  const site = { id: "sample", origin: "https://example.com", deviations: { K1: { reason: "a third-party library names it", value: ["lib_id"] } } };
  const cookie = (/** @type {string} */ value, cache = "private, no-store") => {
    const headers = response({ "Cache-Control": cache });
    headers.append("Set-Cookie", value);
    return headers;
  };
  assert.deepEqual(failed(cookie("__Host-sid=1; Path=/; Secure; HttpOnly; SameSite=Lax")), []);
  assert.equal(failure(cookie("sid=1; Path=/; Secure; HttpOnly; SameSite=Lax"), /prefix/).warn, undefined, "an undeclared bare name is an error");
  const declinedOne = checkSecurityHeaders(cookie("lib_id=1; Path=/; Secure; SameSite=Lax"), { site: /** @type {any} */ (site) }).find((r) => /prefix/.test(r.name));
  assert.equal(declinedOne?.warn, true);
  assert.match(declinedOne?.detail ?? "", /^declared deviation: a third-party library names it/);
  assert.equal(failure(cookie("__Host-sid=1; Path=/; Secure; HttpOnly; SameSite=Lax", "public, max-age=60"), /shared cache/).id, "X1");
});

test("an uploaded file is nosniff and inert: a sandboxed policy or an attachment", () => {
  const file = (/** @type {Record<string, string>} */ headers) => new Headers({ "Content-Type": "image/svg+xml", ...headers });
  const a3 = (/** @type {Headers} */ headers) => failures(checkSecurityHeaders(headers, { standard: {}, csp: false, upload: true })).filter((r) => r.id === "A3").map((r) => r.name);
  assert.deepEqual(a3(file({ "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'" })), []);
  assert.deepEqual(a3(file({ "X-Content-Type-Options": "nosniff", "Content-Disposition": "attachment" })), []);
  assert.deepEqual(a3(file({ "Content-Security-Policy": "sandbox allow-scripts" })), ["an uploaded file is served nosniff", "an uploaded file runs no script: a sandboxed policy or an attachment"]);
});

test("checkSecurityTxt: served as text/plain with a charset, one Expires within the year, its own Canonical; unsigned is the family's notice", () => {
  const url = "https://example.com/.well-known/security.txt";
  const now = Date.parse("2026-10-31T00:00:00Z");
  const grade = (/** @type {string} */ type, /** @type {string} */ body, status = 200) =>
    checkSecurityTxt({ url, origin: "https://example.com", status, headers: new Headers({ "Content-Type": type }), body, now }).filter((r) => !r.pass);
  const good = `Contact: mailto:security@example.com\nExpires: 2027-06-01T00:00:00Z\nCanonical: ${url}\n`;
  assert.deepEqual(grade("text/plain; charset=utf-8", good).map((r) => [r.id, r.notice]), [["D3", true]]);
  assert.deepEqual(grade("text/plain", good).map((r) => r.id), ["D1", "D3"]);
  assert.deepEqual(grade("text/plain; charset=utf-8", good.replace("2027-06-01", "2026-11-15")).map((r) => [r.id, r.warn ?? r.notice]), [["D3", true], ["D4", true]]);
  assert.deepEqual(grade("text/plain; charset=utf-8", good.replace(`Canonical: ${url}`, "Canonical: https://other.example.com/.well-known/security.txt")).map((r) => r.id), ["D3", "D3"]);
  assert.deepEqual(grade("text/html", "", 404).map((r) => `${r.id} ${r.detail}`), ["D1 answers 404"]);
});
