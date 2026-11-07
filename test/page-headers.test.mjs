import assert from "node:assert/strict";
import { test } from "node:test";
import { pageSecurity } from "../page-headers.mjs";

const set = { "X-Content-Type-Options": "nosniff" };
const make = (extra = {}) =>
  pageSecurity({
    set,
    policy: ({ nonce, staged }) => ({
      nonce,
      sources: { img: staged ? ["data:"] : [] },
    }),
    staged: { trustedTypes: true },
    corp: true,
    ...extra,
  });
const req = (url = "https://site.example.com/page") => new Request(url);

test("a page gets the set, its nonced policy, the Report-Only companion and the report endpoint", () => {
  const { withSecurityHeaders, nonceFor } = make();
  const request = req();
  const nonce = nonceFor(request);
  assert.equal(nonceFor(request), nonce);
  const out = withSecurityHeaders(
    new Response("<p>x</p>", { headers: { "Content-Type": "text/html" } }),
    request,
  );
  assert.equal(out.headers.get("X-Content-Type-Options"), "nosniff");
  assert.ok((out.headers.get("Content-Security-Policy") ?? "").includes(`'nonce-${nonce}'`));
  assert.match(
    out.headers.get("Content-Security-Policy-Report-Only") ?? "",
    /require-trusted-types-for/,
  );
  assert.equal(out.headers.get("Cross-Origin-Resource-Policy"), "same-origin");
  assert.equal(
    out.headers.get("Reporting-Endpoints"),
    'csp-endpoint="https://site.example.com/csp-report"',
  );
});

test("a route's own policy and headers win, and plain http off loopback gets no report endpoint", () => {
  const { withSecurityHeaders } = make();
  const own = new Response("x", {
    headers: {
      "Content-Security-Policy": "default-src 'none'",
      "X-Content-Type-Options": "custom",
    },
  });
  const out = withSecurityHeaders(own, req("http://192.0.2.1/x"));
  assert.equal(out.headers.get("Content-Security-Policy"), "default-src 'none'");
  assert.equal(out.headers.get("Content-Security-Policy-Report-Only"), null);
  assert.equal(out.headers.get("X-Content-Type-Options"), "custom");
  assert.equal(out.headers.get("Reporting-Endpoints"), null);
});

test("a policy returned as a string goes on as it is, with no Report-Only companion", () => {
  const { withSecurityHeaders } = make({ policy: () => "default-src 'none'" });
  const out = withSecurityHeaders(new Response("{}"), req());
  assert.equal(out.headers.get("Content-Security-Policy"), "default-src 'none'");
  assert.equal(out.headers.get("Content-Security-Policy-Report-Only"), null);
});

test("an immutable response comes back with the headers, and noindex marks private paths", () => {
  const { withSecurityHeaders } = make({ noindex: (path) => path.startsWith("/admin") });
  const out = withSecurityHeaders(
    Response.redirect("https://site.example.com/", 302),
    req("https://site.example.com/admin"),
  );
  assert.equal(out.status, 302);
  assert.equal(out.headers.get("X-Robots-Tag"), "noindex");
});

test("a site must say what it stages", () => {
  assert.throws(() => pageSecurity({ set, policy: () => ({}) }), /stages/);
});

test("renew: a stored page gets a fresh nonce per reader and its policy is built again for it", () => {
  // renewNonce rewrites the body with HTMLRewriter, which only a Workers runtime has; the headers are what is checked.
  /** @type {any} */ (globalThis).HTMLRewriter = class {
    on() {
      return this;
    }
    transform(/** @type {Response} */ response) {
      return response;
    }
  };
  try {
    const { withSecurityHeaders } = make({ renew: true });
    const stored = new Response("<p>x</p>", {
      headers: {
        "Content-Type": "text/html",
        "Content-Security-Policy": "script-src 'nonce-STALE' 'self'",
      },
    });
    const out = withSecurityHeaders(stored, req());
    const policy = out.headers.get("Content-Security-Policy") ?? "";
    assert.ok(!policy.includes("STALE"));
    assert.match(policy, /'nonce-[^']+'/);
    assert.ok(policy.includes("report-uri"), "the policy is built again, not just renewed");
  } finally {
    delete (/** @type {any} */ (globalThis).HTMLRewriter);
  }
});
