import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { checkSecurityHeaders, failures, parsePolicy } from "../check.mjs";
import { CLOUDFLARE_WEB_ANALYTICS, buildContentSecurityPolicy, buildPolicy, buildStagedPolicy, generateNonce, renewNonce, reportingEndpoints, scriptHash } from "../csp.mjs";
import { applyHeaderSet } from "../headers.mjs";

const SINK = { reportUri: "/csp-report" };
const HASH = "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";
/** @param {import("../csp.mjs").SitePolicy} site */
const directives = (site) => parsePolicy(buildContentSecurityPolicy(site).value);

test("generateNonce: 16 random bytes as 24 base64 characters, fresh each call", () => {
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const nonce = generateNonce();
    assert.match(nonce, /^[A-Za-z0-9+/]{22}==$/);
    assert.equal(Buffer.from(nonce, "base64").length, 16);
    seen.add(nonce);
  }
  assert.equal(seen.size, 50, "a nonce repeated");
});

test("scriptHash is the SHA-256 of the script's UTF-8 text, as a CSP hash source", async () => {
  assert.equal(await scriptHash(""), HASH);
  for (const text of ["alert(1)", "document.title = 'café ✓';\n"]) {
    assert.equal(await scriptHash(text), `sha256-${createHash("sha256").update(text, "utf8").digest("base64")}`);
  }
});

test("buildPolicy refuses an empty or blank directive", () => {
  for (const bad of [[""], ["default-src 'self'", "  "]]) assert.throws(() => buildPolicy(bad), /a CSP directive is empty/);
});

test("a site that loads nothing extra gets the fixed policy, enforced", () => {
  const { name, value } = buildContentSecurityPolicy(SINK);
  assert.equal(name, "Content-Security-Policy");
  assert.deepEqual(Object.fromEntries(parsePolicy(value)), {
    "default-src": ["'self'"],
    "script-src": ["'self'"],
    "style-src": ["'self'"],
    "font-src": ["'self'"],
    "img-src": ["'self'"],
    "connect-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "report-uri": ["/csp-report"],
  });
});

test("framedBySameOrigin lets the site frame its own pages and no one else", () => {
  assert.deepEqual(directives({ ...SINK, framedBySameOrigin: true }).get("frame-ancestors"), ["'self'"]);
  assert.deepEqual(directives({ ...SINK, framedBySameOrigin: false }).get("frame-ancestors"), ["'none'"]);
  const headers = new Headers();
  applyHeaderSet(headers, { "X-Frame-Options": "sameorigin" });
  const { name, value } = buildContentSecurityPolicy({ ...SINK, framedBySameOrigin: true });
  headers.set(name, value);
  assert.deepEqual(failures(checkSecurityHeaders(headers, { standard: { "X-Frame-Options": "deny" } })), []);
});

test("a policy with no report sink is refused", () => {
  assert.throws(() => buildContentSecurityPolicy({}), /needs a report sink/);
  assert.throws(() => buildContentSecurityPolicy({ reportUri: "", reportTo: "" }), /needs a report sink/);
});

test("report-to alone, or both sinks, are written as given", () => {
  const to = directives({ reportTo: "csp-endpoint" });
  assert.deepEqual([...to.keys()].slice(-2), ["frame-ancestors", "report-to"]);
  assert.deepEqual(to.get("report-to"), ["csp-endpoint"]);
  assert.equal(to.has("report-uri"), false);
  assert.deepEqual([...directives(SINK).keys()].slice(-2), ["frame-ancestors", "report-uri"]);
  const both = directives({ reportUri: "/r", reportTo: "csp-endpoint" });
  assert.deepEqual(both.get("report-uri"), ["/r"]);
  assert.deepEqual(both.get("report-to"), ["csp-endpoint"]);
});

test("reportOnly names the Report-Only header and keeps the same policy", () => {
  const reported = buildContentSecurityPolicy({ ...SINK, reportOnly: true });
  assert.equal(reported.name, "Content-Security-Policy-Report-Only");
  assert.equal(reported.value, buildContentSecurityPolicy(SINK).value);
});

test("a nonce goes on script-src and style-src and nowhere else", () => {
  const nonce = generateNonce();
  const policy = directives({ ...SINK, nonce });
  assert.ok(policy.get("script-src")?.includes(`'nonce-${nonce}'`));
  assert.ok(policy.get("style-src")?.includes(`'nonce-${nonce}'`));
  for (const [name, sources] of policy) {
    if (name !== "script-src" && name !== "style-src") assert.ok(!sources.some((s) => s.includes("nonce")), `${name} carries the nonce`);
  }
  assert.ok(!buildContentSecurityPolicy(SINK).value.includes("nonce"), "no nonce was given but one was written");
});

test("a nonce that is short or not base64 is refused", () => {
  assert.doesNotThrow(() => buildContentSecurityPolicy({ ...SINK, nonce: "abcdefghijklmnop" }));
  assert.doesNotThrow(() => buildContentSecurityPolicy({ ...SINK, nonce: "abc-def_ghi+jkl/mn==" }));
  for (const nonce of ["", "abcdefghijklmno", "abcdefghijklmnop'", "'abcdefghijklmnop", " abcdefghijklmnop", "abcdefghijklmnop\n", "abcdefghij klmnop", "abcdefghijklmnop===", "*; abcdefghijklmnop", "abcdefghijklmnop; script-src *"]) {
    assert.throws(() => buildContentSecurityPolicy({ ...SINK, nonce }), /the nonce is not a base64 value/, `accepted ${JSON.stringify(nonce)}`);
  }
});

test("hashes are quoted onto their own directive", () => {
  const policy = directives({ ...SINK, scriptHashes: [HASH], styleHashes: ["sha384-abc"] });
  assert.ok(policy.get("script-src")?.includes(`'${HASH}'`));
  assert.ok(!policy.get("script-src")?.includes("'sha384-abc'"));
  assert.ok(policy.get("style-src")?.includes("'sha384-abc'"));
  assert.ok(!policy.get("style-src")?.includes(`'${HASH}'`));
  assert.ok(directives({ ...SINK, scriptHashes: ["sha512-x_y-z="] }).get("script-src")?.includes("'sha512-x_y-z='"));
});

test("a value that is not a sha256, sha384 or sha512 source is refused as a hash", () => {
  for (const hash of ["sha1-abc", "47DEQpj8HBSa", `'${HASH}'`, "sha256-", "sha256-abc def", "sha256-abc===", "xsha256-abc", "sha256-abc'"]) {
    assert.throws(() => buildContentSecurityPolicy({ ...SINK, scriptHashes: [hash] }), /is not a hash source/, `script accepted ${hash}`);
    assert.throws(() => buildContentSecurityPolicy({ ...SINK, styleHashes: [hash] }), /is not a hash source/, `style accepted ${hash}`);
  }
});

test("each kind's hosts land on that kind's directive, after 'self'", () => {
  const policy = directives({
    ...SINK,
    sources: {
      script: ["https://js.example.com"],
      style: ["https://css.example.com"],
      img: ["https://img.example.com", "data:"],
      font: ["https://fonts.example.com"],
      connect: ["https://api.example.com"],
      frame: ["https://player.example.com"],
      media: ["https://media.example.com"],
    },
  });
  assert.deepEqual(policy.get("script-src"), ["'self'", "https://js.example.com"]);
  assert.deepEqual(policy.get("style-src"), ["'self'", "https://css.example.com"]);
  assert.deepEqual(policy.get("img-src"), ["'self'", "https://img.example.com", "data:"]);
  assert.deepEqual(policy.get("font-src"), ["'self'", "https://fonts.example.com"]);
  assert.deepEqual(policy.get("connect-src"), ["'self'", "https://api.example.com"]);
  assert.deepEqual(policy.get("frame-src"), ["'self'", "https://player.example.com"]);
  assert.deepEqual(policy.get("media-src"), ["'self'", "https://media.example.com"]);
});

test("media-src and frame-src are written only when the site loads some", () => {
  for (const sources of [{}, { media: [], frame: [] }]) {
    const policy = directives({ ...SINK, sources });
    assert.equal(policy.has("media-src"), false);
    assert.equal(policy.has("frame-src"), false);
  }
});

test("a script source that would allow any script is refused", () => {
  for (const host of ["*", "https:", "HTTP:", "data:", "blob:", "'unsafe-inline'", "'unsafe-eval'"]) {
    assert.throws(() => buildContentSecurityPolicy({ ...SINK, sources: { script: [host] } }), /is not an acceptable script source: name the host/, `accepted ${host}`);
  }
  assert.doesNotThrow(() => buildContentSecurityPolicy({ ...SINK, sources: { script: ["https://js.example.com"] } }));
});

test("a wildcard subdomain is refused as a script source", () => {
  for (const host of ["https://*.example.com", "*.example.com:443/js/"]) {
    assert.throws(() => buildContentSecurityPolicy({ ...SINK, sources: { script: [host] } }), /trusts every subdomain/, host);
  }
});

test("an unsafe keyword is refused in any case, since browsers match keywords case-insensitively", () => {
  for (const host of ["'UNSAFE-INLINE'", "'Unsafe-Inline'", "'UNSAFE-EVAL'", "'unsafe-Eval'"]) {
    assert.throws(() => buildContentSecurityPolicy({ ...SINK, sources: { script: [host] } }), /is not an acceptable script source/, `accepted ${host}`);
  }
});

test("a host-source whose host is * matches every host and is refused, with or without scheme, port or path", () => {
  for (const host of ["https://*", "HTTP://*", "https://*:443", "https://*:*", "*:*", "*:8080", "https://*/", "https://*/js/app.js", "wss://*"]) {
    assert.throws(() => buildContentSecurityPolicy({ ...SINK, sources: { script: [host] } }), /is not an acceptable script source: name the host/, `accepted ${host}`);
  }
  assert.doesNotThrow(() => buildContentSecurityPolicy({ ...SINK, sources: { script: ["https://js.example.com/*"] } }));
});

test("only script sources are held to the script rules: other kinds may list a scheme", () => {
  const policy = directives({ ...SINK, sources: { img: ["https:", "data:", "blob:"], media: ["blob:"], connect: ["wss:"] } });
  assert.deepEqual(policy.get("img-src"), ["'self'", "https:", "data:", "blob:"]);
  assert.deepEqual(policy.get("media-src"), ["'self'", "blob:"]);
  assert.deepEqual(policy.get("connect-src"), ["'self'", "wss:"]);
  assert.deepEqual(policy.get("script-src"), ["'self'"]);
});

test("the refusal names the offending source", () => {
  assert.throws(() => buildContentSecurityPolicy({ ...SINK, sources: { script: ["https://js.example.com", "data:"] } }), /^Error: data: is not an acceptable script source/);
});

test("a source with a space, semicolon or comma, or not a string, is refused in every kind and in the sinks", () => {
  for (const kind of ["script", "style", "img", "font", "connect", "frame", "media"]) {
    for (const bad of ["", "https://a.example.com https://b.example.com", "https://a.example.com;script-src", "a,b", 7]) {
      assert.throws(() => buildContentSecurityPolicy({ ...SINK, sources: { [kind]: [bad] } }), /is not a CSP source/, `${kind} accepted ${JSON.stringify(bad)}`);
    }
  }
  assert.throws(() => buildContentSecurityPolicy({ reportUri: "/r; script-src *" }), /is not a CSP source/);
  assert.throws(() => buildContentSecurityPolicy({ reportTo: "a b" }), /is not a CSP source/);
});

test("cloudflareWebAnalytics lets the beacon run and report", () => {
  const policy = directives({ ...SINK, cloudflareWebAnalytics: true });
  for (const source of CLOUDFLARE_WEB_ANALYTICS.script) assert.ok(policy.get("script-src")?.includes(source));
  assert.ok(policy.get("connect-src")?.includes("'self'"));
  const without = directives(SINK);
  assert.ok(!without.get("script-src")?.some((s) => s.includes("cloudflareinsights")));
});

test("styleAttributesInline allows style attributes only, and only when asked", () => {
  assert.deepEqual(directives({ ...SINK, styleAttributesInline: true }).get("style-src-attr"), ["'unsafe-inline'"]);
  assert.equal(directives(SINK).has("style-src-attr"), false);
  assert.ok(!directives({ ...SINK, styleAttributesInline: true }).get("style-src")?.includes("'unsafe-inline'"));
});

test("extra directives are added; an empty one, one that restates a fixed directive or reopens scripts, is refused", () => {
  const policy = directives({ ...SINK, extraDirectives: ["upgrade-insecure-requests", "worker-src 'self'"] });
  assert.deepEqual(policy.get("upgrade-insecure-requests"), []);
  assert.deepEqual(policy.get("worker-src"), ["'self'"]);
  assert.throws(() => buildContentSecurityPolicy({ ...SINK, extraDirectives: [" "] }), /a CSP directive is empty/);
  for (const extra of ["script-src-elem 'unsafe-inline'", "script-src-attr 'unsafe-inline'", "style-src-elem 'unsafe-inline'", "STYLE-SRC *", "img-src *", "connect-src *", "frame-src 'self'", "form-action *", "frame-ancestors *"]) {
    assert.throws(() => buildContentSecurityPolicy({ ...SINK, extraDirectives: [extra] }), /written by the builder/, extra);
  }
  assert.throws(() => buildContentSecurityPolicy({ ...SINK, extraDirectives: ["worker-src *"] }), /not an acceptable worker source/);
});

test("PLANT: formTargets adds https origins to form-action 'self'; a wildcard, a path, http or noForms is refused", () => {
  assert.deepEqual(directives({ ...SINK, formTargets: ["https://checkout.stripe.com", "https://connect.stripe.com"] }).get("form-action"), ["'self'", "https://checkout.stripe.com", "https://connect.stripe.com"]);
  for (const target of ["*", "https://*.stripe.com", "https:", "http://checkout.stripe.com", "https://checkout.stripe.com/pay", "checkout.stripe.com"]) {
    assert.throws(() => buildContentSecurityPolicy({ ...SINK, formTargets: [target] }), /not a form target/, target);
  }
  assert.throws(() => buildContentSecurityPolicy({ ...SINK, noForms: true, formTargets: ["https://checkout.stripe.com"] }), /cannot go with noForms/);
});

test("every policy the builder writes passes the header check", () => {
  const sites = [
    SINK,
    { reportTo: "csp" },
    { ...SINK, nonce: generateNonce(), styleAttributesInline: true },
    { ...SINK, scriptHashes: [HASH], cloudflareWebAnalytics: true, sources: { script: ["https://js.example.com"], img: ["data:"], frame: ["https://player.example.com"] } },
    { ...SINK, formTargets: ["https://checkout.stripe.com"] },
  ];
  for (const site of sites) {
    const headers = new Headers();
    applyHeaderSet(headers);
    const { name, value } = buildContentSecurityPolicy(site);
    headers.set(name, value);
    assert.deepEqual(failures(checkSecurityHeaders(headers, { cloudflareWebAnalytics: Boolean(site.cloudflareWebAnalytics), formTargets: site.formTargets })), [], JSON.stringify(site));
  }
});

test("inlineScripts opts script-src into 'unsafe-inline' alone; beside a nonce or hashes, which void it, it is refused", () => {
  const site = { ...SINK, inlineScripts: /** @type {const} */ ("unsafe-inline") };
  assert.deepEqual(directives(site).get("script-src"), ["'self'", "'unsafe-inline'"]);
  for (const extra of [{ nonce: generateNonce() }, { scriptHashes: [HASH] }]) {
    assert.throws(() => buildContentSecurityPolicy({ ...site, ...extra }), /cannot go with a nonce or script hashes/);
  }
  assert.throws(() => buildContentSecurityPolicy({ ...SINK, inlineScripts: /** @type {any} */ ("unsafe-eval") }), /inlineScripts is "unsafe-inline"/);
  const headers = new Headers({ "Content-Security-Policy": buildContentSecurityPolicy(site).value });
  assert.ok(failures(checkSecurityHeaders(headers, { standard: {} })).some((r) => /'unsafe-inline'/.test(r.name)));
  assert.deepEqual(failures(checkSecurityHeaders(headers, { standard: {}, inlineScripts: "unsafe-inline" })), []);
});

test("strictDynamic follows the nonce or hashes; without one, beside the beacon, or as a raw source, it is refused", () => {
  const nonce = generateNonce();
  assert.deepEqual(directives({ ...SINK, nonce, strictDynamic: true }).get("script-src"), [`'nonce-${nonce}'`, "'self'", "'strict-dynamic'"]);
  assert.ok(directives({ ...SINK, scriptHashes: [HASH], strictDynamic: true }).get("script-src")?.includes("'strict-dynamic'"));
  assert.throws(() => buildContentSecurityPolicy({ ...SINK, strictDynamic: true }), /needs a nonce or script hashes/);
  assert.throws(() => buildContentSecurityPolicy({ ...SINK, nonce, strictDynamic: true, cloudflareWebAnalytics: true }), /cannot go with cloudflareWebAnalytics/);
  for (const raw of ["'strict-dynamic'", "'STRICT-DYNAMIC'"]) {
    assert.throws(() => buildContentSecurityPolicy({ ...SINK, nonce, sources: { script: [raw] } }), /pass strictDynamic: true/, raw);
  }
});

test("reportingEndpoints takes https or loopback http and refuses what a browser ignores", () => {
  assert.equal(reportingEndpoints("csp-endpoint", new URL("/csp-report", "https://example.com")), 'csp-endpoint="https://example.com/csp-report"');
  for (const url of ["http://localhost:5173/r", "http://foo.localhost/r", "http://127.0.0.2/r", "http://[::1]:8787/r"]) assert.ok(reportingEndpoints("csp-endpoint", url));
  for (const url of ["/csp-report", "http://example.com/csp-report", "http://localhost.example.com/r", "http://notlocalhost/r", "http://127.0.0.1.example.com/r"]) {
    assert.throws(() => reportingEndpoints("csp-endpoint", url));
  }
});

test("trustedTypes writes require-trusted-types-for, and its names; the staged companion is Report-Only and refuses staging nothing", () => {
  const staged = buildStagedPolicy(SINK, { trustedTypes: ["default", "'allow-duplicates'"] });
  assert.equal(staged.name, "Content-Security-Policy-Report-Only");
  const policy = parsePolicy(staged.value);
  assert.deepEqual(policy.get("require-trusted-types-for"), ["'script'"]);
  assert.deepEqual(policy.get("trusted-types"), ["default", "'allow-duplicates'"]);
  assert.throws(() => buildContentSecurityPolicy({ ...SINK, trustedTypes: ["bad name"] }), /Trusted Types policy name/);
  assert.throws(() => buildStagedPolicy(SINK, {}), /stages nothing/);
});

test("renewNonce leaves a response with no nonce as it is, and refuses to resend a stored nonce without HTMLRewriter", () => {
  const plain = new Response("x", { headers: { "Content-Type": "text/html", "Content-Security-Policy": "script-src 'self'" } });
  assert.equal(renewNonce(plain), plain);
  const json = new Response("{}", { headers: { "Content-Type": "application/json", "Content-Security-Policy": `script-src 'nonce-${generateNonce()}'` } });
  assert.equal(renewNonce(json), json);
  if (typeof globalThis.HTMLRewriter !== "undefined") return;
  const stored = new Response("<script nonce=a></script>", { headers: { "Content-Type": "text/html", "Content-Security-Policy": `script-src 'nonce-${generateNonce()}'` } });
  assert.throws(() => renewNonce(stored), /needs HTMLRewriter/);
});
