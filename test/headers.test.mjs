import assert from "node:assert/strict";
import { test } from "node:test";
import { LOGOUT_HEADERS, OWASP_SKIPPED, STANDARD_SECURITY_HEADERS, applyHeaderSet, buildSecurityHeaders } from "../headers.mjs";
import { OWASP_RECOMMENDED } from "../owasp-headers.mjs";

const REASON = "the site embeds a cross-origin player";

test("the standard set is OSHP's recommendations minus the four skipped, in OSHP's words", () => {
  assert.deepEqual(Object.keys(OWASP_SKIPPED).sort(), ["Cache-Control", "Clear-Site-Data", "Content-Security-Policy", "Cross-Origin-Embedder-Policy"]);
  for (const [name, reason] of Object.entries(OWASP_SKIPPED)) {
    assert.ok(reason.length > 40, `${name} is skipped with no reason written down`);
    assert.ok(name in OWASP_RECOMMENDED, `${name} is skipped but OSHP does not recommend it`);
    assert.equal(name in STANDARD_SECURITY_HEADERS, false, `${name} is skipped but sent`);
  }
  const expected = Object.entries(OWASP_RECOMMENDED).filter(([name]) => !(name in OWASP_SKIPPED));
  assert.deepEqual(Object.entries(STANDARD_SECURITY_HEADERS), expected);
  assert.equal(STANDARD_SECURITY_HEADERS["X-Frame-Options"], "deny");
  assert.equal(STANDARD_SECURITY_HEADERS["Strict-Transport-Security"], "max-age=63072000; includeSubDomains");
});

test("the exported sets cannot be changed by a site", () => {
  for (const set of [STANDARD_SECURITY_HEADERS, OWASP_SKIPPED, LOGOUT_HEADERS]) assert.ok(Object.isFrozen(set));
  assert.throws(() => {
    "use strict";
    /** @type {any} */ (STANDARD_SECURITY_HEADERS)["X-Frame-Options"] = "sameorigin";
  }, TypeError);
});

test("the logout set is OSHP's Clear-Site-Data and nothing else", () => {
  assert.deepEqual({ ...LOGOUT_HEADERS }, { "Clear-Site-Data": '"cache","cookies","storage"' });
});

test("with no overrides a site gets the standard set, as its own copy", () => {
  for (const built of [buildSecurityHeaders(), buildSecurityHeaders({}), buildSecurityHeaders({ overrides: {} })]) {
    assert.deepEqual(built, { ...STANDARD_SECURITY_HEADERS });
    built["X-Frame-Options"] = "sameorigin";
    assert.equal(STANDARD_SECURITY_HEADERS["X-Frame-Options"], "deny", "changing a built set changed the standard");
  }
});

test("an override replaces a value, adds a header, or with null removes one", () => {
  const built = buildSecurityHeaders({
    overrides: {
      "X-Frame-Options": { value: "sameorigin", reason: REASON },
      "Cross-Origin-Embedder-Policy": { value: "require-corp", reason: "cross-origin isolation for the WASM worker" },
      "X-DNS-Prefetch-Control": { value: null, reason: "prefetch measured faster for this site" },
    },
  });
  assert.equal(built["X-Frame-Options"], "sameorigin");
  assert.equal(built["Cross-Origin-Embedder-Policy"], "require-corp");
  assert.equal("X-DNS-Prefetch-Control" in built, false);
  assert.equal(built["X-Content-Type-Options"], "nosniff", "an untouched header kept its standard value");
});

test("an override with no reason, or one under 12 characters, is refused", () => {
  const attempt = (/** @type {any} */ reason) => () => buildSecurityHeaders({ overrides: { "X-Frame-Options": { value: "sameorigin", reason } } });
  for (const reason of [undefined, null, 42, "", "because", "too short!!", "   short    "]) {
    assert.throws(attempt(reason), /X-Frame-Options gives no reason/, `accepted ${JSON.stringify(reason)}`);
  }
  assert.doesNotThrow(attempt("exactly 12 c"));
  assert.doesNotThrow(attempt("  exactly 12 c  "));
});

test("an override that says what the standard says is refused", () => {
  assert.throws(
    () => buildSecurityHeaders({ overrides: { "X-Frame-Options": { value: "deny", reason: REASON } } }),
    /X-Frame-Options says what the standard already says/,
  );
});

test("null on a header the standard does not send is refused", () => {
  assert.throws(
    () => buildSecurityHeaders({ overrides: { "Cache-Control": { value: null, reason: REASON } } }),
    /Cache-Control removes a header the standard does not send/,
  );
});

test("an empty or blank value is refused: null is the way to send none", () => {
  for (const value of ["", "   "]) {
    assert.throws(
      () => buildSecurityHeaders({ overrides: { "X-Frame-Options": { value, reason: REASON } } }),
      /X-Frame-Options is empty; use null to send none/,
    );
  }
});

test("applyHeaderSet stamps the standard set by default and overwrites what a route set", () => {
  const headers = new Headers({ "X-Frame-Options": "allowall", "Content-Type": "text/html" });
  applyHeaderSet(headers);
  for (const [name, value] of Object.entries(STANDARD_SECURITY_HEADERS)) assert.equal(headers.get(name), value);
  assert.equal(headers.get("Content-Type"), "text/html; charset=utf-8", "a bare text type names its charset");
});

test("applyHeaderSet with overwrite false keeps a route's value and fills the rest", () => {
  const headers = new Headers({ "X-Frame-Options": "sameorigin" });
  applyHeaderSet(headers, STANDARD_SECURITY_HEADERS, { overwrite: false });
  assert.equal(headers.get("X-Frame-Options"), "sameorigin");
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
});

test("applyHeaderSet applies the set it is given, such as a site's built set or the logout set", () => {
  const headers = new Headers();
  applyHeaderSet(headers, LOGOUT_HEADERS);
  assert.deepEqual([...headers.keys()], ["clear-site-data"]);
  const site = buildSecurityHeaders({ overrides: { "X-Frame-Options": { value: "sameorigin", reason: REASON } } });
  const page = new Headers({ "X-Frame-Options": "deny" });
  applyHeaderSet(page, site);
  assert.equal(page.get("X-Frame-Options"), "sameorigin");
});

test("applyHeaderSet throws on immutable headers, as documented, rather than skipping them", () => {
  const redirect = Response.redirect("https://example.com/", 302);
  assert.throws(() => applyHeaderSet(redirect.headers), TypeError);
  const rebuilt = new Response(redirect.body, { status: redirect.status, headers: new Headers(redirect.headers) });
  applyHeaderSet(rebuilt.headers);
  assert.equal(rebuilt.headers.get("X-Frame-Options"), "deny");
  assert.equal(rebuilt.headers.get("Location"), "https://example.com/");
});

test("the static _headers file leaves out the policy and detaches a header a path changes", async () => {
  const { headersFile } = await import("../headers.mjs");
  const file = headersFile(
    { "X-Frame-Options": "deny", "Cross-Origin-Resource-Policy": "same-origin", "Content-Security-Policy": "default-src 'self'" },
    { paths: { "/favicon.svg": { "Cross-Origin-Resource-Policy": "cross-origin" }, "/assets/*": { "Cache-Control": "public, max-age=31536000, immutable" } }, comment: "Generated." },
  );
  assert.equal(
    file,
    "# Generated.\n/*\n  X-Frame-Options: deny\n  Cross-Origin-Resource-Policy: same-origin\n\n" +
      "/favicon.svg\n  ! Cross-Origin-Resource-Policy\n  Cross-Origin-Resource-Policy: cross-origin\n\n" +
      "/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n",
  );
  assert.throws(() => headersFile({ "X-A": "a\nb" }));
});

test("charset: true gives each static text type its charset", async () => {
  const { headersFile } = await import("../headers.mjs");
  const file = headersFile({ "X-Frame-Options": "deny" }, { charset: true });
  assert.match(file, /\n\/\*\.css\n {2}Content-Type: text\/css; charset=utf-8\n/);
  assert.doesNotMatch(headersFile({ "X-Frame-Options": "deny" }), /Content-Type/);
});
