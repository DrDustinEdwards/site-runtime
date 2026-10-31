// The live sign-in check against a fake site: a site that does everything right has no errors, each planted gap fails
// its own item (the confirm page found at the site's own path, as txasm's /signin/confirm), a site with no sign-in,
// admin or MCP has no findings (unless its registry entry declares a page, which must then answer), and a site that does
// not answer cannot be checked.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

import { signInFindings } from "../sign-in-live.mjs";

/** @type {"good" | "bad" | "bare"} */
let mode = "good";
let origin = "";
const PRIVATE = { "cache-control": "private, no-store" };
const COOKIE = "__Secure-better-auth.better-auth-passkey=x; Max-Age=300; Path=/; HttpOnly; Secure; SameSite=Lax";

/** @type {Record<string, (bad: boolean) => [number, Record<string, string | string[]>, string?]>} */
const routes = {
  "GET /login": (bad) => [
    200,
    { "content-type": "text/html", ...PRIVATE, ...(bad ? {} : { "x-robots-tag": "noindex" }) },
    `<form><input type="email" name="email" autocomplete="${bad ? "email" : "username webauthn"}">${bad ? "" : '<div data-key="0x4AAAAAAFsample00"></div>'}</form>`,
  ],
  "GET /api/auth/ok": () => [200, { "content-type": "application/json" }, '{"ok":true}'],
  "GET /api/auth/passkey/generate-authenticate-options": (bad) => [200, { "content-type": "application/json", ...PRIVATE, "set-cookie": COOKIE }, JSON.stringify({ rpId: bad ? "sample.workers.dev" : "127.0.0.1" })],
  "POST /api/auth/sign-out": (bad) => [200, { "content-type": "application/json", ...PRIVATE, ...(bad ? { "set-cookie": "session_token=; Path=/" } : { "clear-site-data": '"cache","cookies","storage"' }) }, '{"success":true}'],
  "GET /signin/confirm": (bad) => (bad ? [302, { location: "/", "set-cookie": "__Secure-better-auth.session_token=x; Path=/; HttpOnly; Secure; SameSite=Lax" }] : [405, PRIVATE]),
  "GET /admin": (bad) => (bad ? [200, { "content-type": "text/html" }, "<h1>Admin</h1>"] : [302, { location: "https://sample.cloudflareaccess.com/cdn-cgi/access/login/sample", ...PRIVATE }]),
  "POST /mcp": () => [401, { "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` }],
  "GET /.well-known/oauth-protected-resource/mcp": () => [200, { "content-type": "application/json" }, JSON.stringify({ resource: `${origin}/mcp`, authorization_servers: [origin] })],
  "GET /.well-known/oauth-authorization-server": (bad) => [
    200,
    { "content-type": "application/json" },
    JSON.stringify({ issuer: origin, registration_endpoint: `${origin}/register`, code_challenge_methods_supported: bad ? ["plain", "S256"] : ["S256"], client_id_metadata_document_supported: !bad }),
  ],
};

let server;
before(async () => {
  server = createServer((req, res) => {
    const key = `${req.method} ${new URL(req.url ?? "/", "http://x").pathname}`;
    // Better Auth refuses another origin only when the request carries a cookie; the bad site never does.
    if (key === "POST /api/auth/sign-out" && req.headers.cookie && req.headers.origin !== origin && mode === "good") return res.writeHead(403).end();
    const route = mode !== "bare" && routes[key];
    const [status, headers, body] = route ? route(mode === "bad") : key === "GET /" ? [200, { "content-type": "text/html" }, "<p>home"] : [404, {}];
    res.writeHead(status, headers).end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const errors = ({ findings }) => [...new Set(findings.filter((f) => f.severity === "error").map((f) => f.item))].sort();

test("a site that does everything right has no errors", async () => {
  mode = "good";
  const result = await signInFindings({ origin });
  assert.deepEqual(result.findings, []);
  assert.equal(result.found.length, 4);
});

test("PLANT: each gap fails its own item, and no cookie value is printed", async () => {
  mode = "bad";
  const result = await signInFindings({ origin });
  assert.deepEqual(errors(result), ["A1", "A2", "B5", "B7", "D1", "D10", "D4", "D8", "G1", "H2", "H4"]);
  assert.doesNotMatch(JSON.stringify(result.findings), /=x\b/);
});

test("a site with no sign-in, admin or MCP has no findings; one that does not answer cannot be checked", async () => {
  mode = "bare";
  assert.deepEqual(await signInFindings({ origin }), { findings: [], found: [] });
  // A page the registry declares (dustinedwards.info's /lab) must answer, not be skipped as absent.
  assert.deepEqual(errors(await signInFindings({ origin, probes: { admin: ["/lab"] } })), ["G1"]);
  await assert.rejects(signInFindings({ origin: "http://127.0.0.1:1" }), /did not answer/);
});
