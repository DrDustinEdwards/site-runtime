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

test("an immutable response comes back with the headers, noindex marks private paths, env and a report origin reach the policy and a route cannot loosen framing", () => {
  const { withSecurityHeaders } = make({ noindex: (path) => path.startsWith("/admin") });
  const out = withSecurityHeaders(
    Response.redirect("https://site.example.com/", 302),
    req("https://site.example.com/admin"),
  );
  assert.equal(out.status, 302);
  assert.equal(out.headers.get("X-Robots-Tag"), "noindex");
});

test("renew: a stored page gets a fresh nonce per reader and its policy is built again for it", async () => {
  {
    const { withSecurityHeaders } = make({ renew: true });
    const stored = new Response('<script nonce="STALE"></script>', {
      headers: {
        "Content-Type": "text/html",
        "Content-Security-Policy": "script-src 'nonce-STALE' 'self'",
      },
    });
    const out = withSecurityHeaders(stored, req());
    const policy = out.headers.get("Content-Security-Policy") ?? "";
    assert.ok(!policy.includes("STALE"));
    const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
    assert.ok(nonce);
    assert.ok(policy.includes("report-uri"), "the policy is built again, not just renewed");
    assert.equal(await out.text(), `<script nonce="${nonce}"></script>`);
    // A fresh render carries this request's own nonce: applying the headers again leaves it alone.
    const { withSecurityHeaders: again, nonceFor } = make({ renew: true });
    const request = req();
    const own = nonceFor(request);
    const fresh = new Response(`<script nonce="${own}"></script>`, {
      headers: {
        "Content-Type": "text/html",
        "Content-Security-Policy": `script-src 'nonce-${own}' 'self'`,
      },
    });
    assert.equal(await again(fresh, request).text(), `<script nonce="${own}"></script>`);
  }
  {
    const { withSecurityHeaders } = make({
      set: { ...set, "X-Frame-Options": "DENY" },
      policy: ({ nonce, env }) => ({ nonce, sources: { img: [env.img] } }),
      reportOrigin: ({ env }) => env.door,
    });
    const env = { img: "https://img.example.com", door: "https://door.example.com" };
    const html = { "Content-Type": "text/html" };
    const page = withSecurityHeaders(new Response("x", { headers: html }), req(), undefined, env);
    assert.match(
      page.headers.get("Content-Security-Policy") ?? "",
      /img-src[^;]*img\.example\.com/,
    );
    assert.match(
      page.headers.get("Content-Security-Policy") ?? "",
      /report-uri https:\/\/door\.example\.com\/csp-report/,
    );
    assert.equal(
      page.headers.get("Reporting-Endpoints"),
      'csp-endpoint="https://door.example.com/csp-report"',
    );
    const framed = (value) =>
      withSecurityHeaders(
        new Response("x", { headers: { ...html, "X-Frame-Options": value } }),
        req(),
        undefined,
        env,
      ).headers.get("X-Frame-Options");
    assert.equal(framed("SAMEORIGIN"), "SAMEORIGIN");
    assert.equal(framed("ALLOWALL"), "DENY");
  }
});

test("unpoliced: a feed gets the set but no policy or companion, a page still does", () => {
  const { withSecurityHeaders } = make({ unpoliced: (type) => !type?.includes("text/html") });
  const feed = withSecurityHeaders(
    new Response("<rss/>", { headers: { "Content-Type": "application/rss+xml" } }),
    req(),
  );
  assert.equal(feed.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(feed.headers.get("Content-Security-Policy"), null);
  assert.equal(feed.headers.get("Content-Security-Policy-Report-Only"), null);
  const page = withSecurityHeaders(
    new Response("<p>x</p>", { headers: { "Content-Type": "text/html" } }),
    req(),
  );
  assert.ok(page.headers.get("Content-Security-Policy"));
});
