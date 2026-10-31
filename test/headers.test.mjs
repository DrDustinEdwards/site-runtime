import assert from "node:assert/strict";
import { test } from "node:test";
import { LOGOUT_HEADERS, OWASP_SKIPPED, STANDARD_SECURITY_HEADERS, applyHeaderSet, buildSecurityHeaders, hostCookie, logoutResponse } from "../headers.mjs";

const REASON = "the site embeds a cross-origin player";

test("the exported sets cannot be changed by a site", () => {
  for (const set of [STANDARD_SECURITY_HEADERS, OWASP_SKIPPED, LOGOUT_HEADERS]) assert.ok(Object.isFrozen(set));
  assert.throws(() => {
    "use strict";
    /** @type {any} */ (STANDARD_SECURITY_HEADERS)["X-Frame-Options"] = "sameorigin";
  }, TypeError);
});

test("logoutResponse clears the site's data on a 303 that is never stored", () => {
  assert.deepEqual({ ...LOGOUT_HEADERS }, { "Clear-Site-Data": '"cache","cookies","storage"' });
  const res = logoutResponse("/signed-out");
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("Location"), "/signed-out");
  assert.equal(res.headers.get("Clear-Site-Data"), LOGOUT_HEADERS["Clear-Site-Data"]);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
});

test("hostCookie writes a __Host- cookie that is Secure, HttpOnly and SameSite, and refuses what would weaken it", () => {
  assert.equal(hostCookie("sid", "abc", { maxAge: 3600 }), "__Host-sid=abc; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=3600");
  assert.equal(hostCookie("pref", "1", { sameSite: "Strict", httpOnly: false }), "__Host-pref=1; Path=/; Secure; SameSite=Strict");
  for (const bad of [() => hostCookie("__Host-sid", "a"), () => hostCookie("s id", "a"), () => hostCookie("sid", "a;b"), () => hostCookie("sid", "a", { sameSite: /** @type {any} */ ("None") })]) assert.throws(bad);
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

test("charset: true gives each static text type its charset, and subresources cross-origin CORP, merged with a site's own rule", async () => {
  const { headersFile } = await import("../headers.mjs");
  const file = headersFile({ "X-Frame-Options": "deny", "Cross-Origin-Resource-Policy": "same-origin" }, { charset: true, paths: { "/*.css": { "Cache-Control": "no-cache" } } });
  assert.match(file, /\n\/\*\.css\n {2}! Cross-Origin-Resource-Policy\n {2}Content-Type: text\/css; charset=utf-8\n {2}Cross-Origin-Resource-Policy: cross-origin\n {2}Cache-Control: no-cache\n/);
  assert.match(file, /\n\/\*\.woff2\n {2}! Cross-Origin-Resource-Policy\n {2}Cross-Origin-Resource-Policy: cross-origin\n/);
  assert.match(file, /\n\/\*\.html\n {2}Content-Type: text\/html; charset=utf-8\n\n/, "a page keeps same-origin");
  assert.doesNotMatch(headersFile({ "X-Frame-Options": "deny" }), /Content-Type/);
});
