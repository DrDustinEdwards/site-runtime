// The consent step and the Access round trip, against a fake provider that records what the handler hands it and a
// fake Access (token endpoint and keys), and the registration allowlist. PLANT tests are the ones that fail if the
// guard they name is removed.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";

import { describeRedirect, isAdminUser, loginHandler, registrationLimited, registrationRefusal } from "../mcp-login.mjs";
import { publicJwk as jwk, sign as idToken } from "./jwt.mjs";

const ORIGIN = "https://wrapper.test";
const TEAM = "https://sample.cloudflareaccess.com";
const ISSUER = `${TEAM}/cdn-cgi/access/sso/oidc/client-id`;
const AUTH_REQUEST = { clientId: "https://client.example.com/meta", redirectUri: "https://client.example.com/cb", scope: ["s.read", "s.write"], state: "s" };

const handler = loginHandler({ name: "Sample Admin", scopes: { read: "s.read", write: "s.write" }, about: "<p>Sample.</p>", admit: isAdminUser });

function setup() {
  /** @type {{ upstream?: { request: typeof AUTH_REQUEST, data: { verifier: string, nonce: string } }, approvedScope?: string[], completed?: Record<string, any> }} */
  const seen = {};
  const env = /** @type {any} */ ({
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_SAAS_CLIENT_ID: "client-id",
    ACCESS_SAAS_CLIENT_SECRET: "client-secret",
    ADMIN_EMAIL: "admin@example.com",
    PUBLIC_ORIGIN: ORIGIN,
    OAUTH_PROVIDER: {
      /** @param {Request} _request @param {string} handle @param {{ scope: string[] }} options */
      async approveConsent(_request, handle, options) {
        assert.equal(handle, "h1");
        seen.approvedScope = options.scope;
        return { request: AUTH_REQUEST, headers: new Headers() };
      },
      /** @param {typeof AUTH_REQUEST} request @param {{ data: { verifier: string, nonce: string } }} options */
      async beginUpstream(request, options) {
        seen.upstream = { request, data: options.data };
        return { state: "upstream-state", headers: new Headers({ "Set-Cookie": "__Host-upstream=bound" }) };
      },
      async finishUpstream() {
        assert.ok(seen.upstream, "the callback came before the sign-in started");
        return { ...seen.upstream, headers: new Headers() };
      },
      async lookupClient() {
        return { clientName: "Sample Client" };
      },
      /** @param {Record<string, unknown>} options */
      async completeAuthorization(options) {
        seen.completed = options;
        return { redirectTo: "https://client.example.com/cb?code=x" };
      },
    },
  });
  return { env, seen };
}

const realFetch = globalThis.fetch;
/** @type {(nonce: string) => Record<string, unknown>} */
let tokenClaims;
let lastNonce = "";

beforeEach(() => {
  tokenClaims = (nonce) => ({ iss: ISSUER, aud: "client-id", exp: Math.floor(Date.now() / 1000) + 300, nonce, email: "Admin@Example.com" });
  globalThis.fetch = /** @type {typeof fetch} */ (
    async (input, init) => {
      const url = String(input);
      if (url === `${ISSUER}/jwks`) return Response.json({ keys: [jwk] });
      assert.equal(url, `${ISSUER}/token`);
      assert.equal(new URLSearchParams(String(init?.body)).get("redirect_uri"), `${ORIGIN}/callback`);
      return Response.json({ id_token: await idToken(tokenClaims(lastNonce)) });
    }
  );
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** @param {any} env @param {boolean} allowWrite */
async function approve(env, allowWrite) {
  const form = new URLSearchParams();
  form.set("handle", "h1");
  form.set("decision", "approve");
  if (allowWrite) form.set("allow_write", "1");
  return handler.fetch(new Request(`${ORIGIN}/authorize`, { method: "POST", body: form }), env);
}

describe("the consent POST", () => {
  test("sends the browser to Access with the provider's state, and keeps the verifier and nonce in it, not in a cookie", async () => {
    const { env, seen } = setup();
    const res = await approve(env, true);
    assert.equal(res.status, 302);
    const location = new URL(res.headers.get("location") ?? "");
    assert.equal(location.origin + location.pathname, `${ISSUER}/authorization`);
    assert.equal(location.searchParams.get("state"), "upstream-state");
    assert.equal(location.searchParams.get("redirect_uri"), `${ORIGIN}/callback`);
    assert.equal(location.searchParams.get("nonce"), seen.upstream?.data.nonce);
    const verifier = seen.upstream?.data.verifier ?? "";
    assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
    // PLANT: neither the verifier nor the nonce reaches the browser outside the Access URL's nonce.
    assert.equal(res.headers.get("set-cookie"), "__Host-upstream=bound");
    assert.ok(!location.href.includes(verifier));
  });

  test("PLANT: the grant is what the box says, read only unless ticked", async () => {
    const off = setup();
    await approve(off.env, false);
    assert.deepEqual(off.seen.approvedScope, ["s.read"]);
    assert.deepEqual(off.seen.upstream?.request.scope, ["s.read"]);
    const on = setup();
    await approve(on.env, true);
    assert.deepEqual(on.seen.approvedScope, ["s.read", "s.write"]);
  });

  test("PLANT: a body that is not the form, or is over 64 KiB, is refused before it is parsed", async () => {
    const { env } = setup();
    const post = (/** @type {BodyInit} */ body) => handler.fetch(new Request(`${ORIGIN}/authorize`, { method: "POST", body }), env);
    assert.deepEqual([(await post("{}")).status, (await post(new URLSearchParams({ handle: "x".repeat(70_000) }))).status], [415, 413]);
  });
});

describe("the callback", () => {
  /** @param {any} env @param {ReturnType<typeof setup>["seen"]} seen */
  async function signIn(env, seen) {
    await approve(env, false);
    lastNonce = seen.upstream?.data.nonce ?? "";
    return handler.fetch(new Request(`${ORIGIN}/callback?code=c1&state=upstream-state`), env);
  }

  test("the administrator, by email in any case, completes with the granted scope", async () => {
    const { env, seen } = setup();
    const res = await signIn(env, seen);
    assert.equal(res.headers.get("location"), "https://client.example.com/cb?code=x");
    assert.equal(seen.completed?.userId, "admin@example.com");
    assert.deepEqual(seen.completed?.scope, ["s.read"]);
    assert.deepEqual(seen.completed?.props, { email: "Admin@Example.com", scopes: ["s.read"], client: "Sample Client", clientId: AUTH_REQUEST.clientId });
  });

  test("a server with several people: an admit object travels with the grant, and its refusal names who is let in", async () => {
    const team = loginHandler({
      name: "Sample Team",
      scopes: { read: "s.read", write: "s.write" },
      about: "<p>Sample.</p>",
      admit: (_env, user) => (user.email.toLowerCase() === "admin@example.com" ? { personId: 7 } : null),
      admits: { consent: "Only people Sample knows are let in.", refusal: "This person is not in Sample." },
    });
    const { env, seen } = setup();
    await approve(env, false);
    lastNonce = seen.upstream?.data.nonce ?? "";
    await team.fetch(new Request(`${ORIGIN}/callback?code=c1&state=upstream-state`), env);
    assert.equal(seen.completed?.props.personId, 7);
    const other = setup();
    tokenClaims = (nonce) => ({ iss: ISSUER, aud: "client-id", exp: Math.floor(Date.now() / 1000) + 300, nonce, email: "someone@example.com" });
    await approve(other.env, false);
    lastNonce = other.seen.upstream?.data.nonce ?? "";
    const res = await team.fetch(new Request(`${ORIGIN}/callback?code=c1&state=upstream-state`), other.env);
    assert.equal(new URL(res.headers.get("location") ?? "").searchParams.get("error_description"), "This person is not in Sample.");
    assert.equal(other.seen.completed, undefined);
  });

  test("PLANT: anyone else is refused back to the client, and nothing is granted", async () => {
    const { env, seen } = setup();
    tokenClaims = (nonce) => ({ iss: ISSUER, aud: "client-id", exp: Math.floor(Date.now() / 1000) + 300, nonce, email: "someone@example.com" });
    const res = await signIn(env, seen);
    assert.equal(new URL(res.headers.get("location") ?? "").searchParams.get("error"), "access_denied");
    assert.equal(seen.completed, undefined);
  });

  test("PLANT: an unset ADMIN_EMAIL admits nobody", async () => {
    const { env, seen } = setup();
    env.ADMIN_EMAIL = " ";
    const res = await signIn(env, seen);
    assert.equal(new URL(res.headers.get("location") ?? "").searchParams.get("error"), "access_denied");
    assert.equal(seen.completed, undefined);
  });

  test("PLANT: a token carrying another sign-in's nonce is refused", async () => {
    const { env, seen } = setup();
    tokenClaims = () => ({ iss: ISSUER, aud: "client-id", exp: Math.floor(Date.now() / 1000) + 300, nonce: "another", email: "admin@example.com" });
    const res = await signIn(env, seen);
    assert.equal(new URL(res.headers.get("location") ?? "").searchParams.get("error"), "access_denied");
    assert.equal(seen.completed, undefined);
  });
});

describe("registrationRefusal", () => {
  const GEMINI = "https://vertexaisearch.cloud.google.com/oauth-redirect";
  const LIST = ` ${GEMINI} , https://grok.com/connectors/oauth/callback`;

  test("allows only redirect URIs listed exactly, and an empty list refuses all", () => {
    assert.equal(registrationRefusal(LIST, { redirect_uris: [GEMINI] }), null);
    assert.match(registrationRefusal("", { redirect_uris: [GEMINI] }) ?? "", /closed/);
    assert.match(registrationRefusal(LIST, { redirect_uris: [] }) ?? "", /at least one/);
  });

  test("PLANT: a near miss, or an http callback even when listed, is refused, naming it", () => {
    const listed = `${LIST} http://insecure.example/cb`;
    for (const uri of [`${GEMINI}/`, `${GEMINI}?x=1`, "https://vertexaisearch.cloud.google.com/oauth", GEMINI.toUpperCase(), "http://insecure.example/cb"]) {
      assert.match(registrationRefusal(listed, { redirect_uris: [GEMINI, uri] }) ?? "", /not allowlisted/, uri);
    }
  });
});

describe("registrationLimited", () => {
  test("PLANT: the sixth registration from one address in an hour is refused", async () => {
    const store = new Map();
    const kv = { get: async (/** @type {string} */ k) => store.get(k) ?? null, put: async (/** @type {string} */ k, /** @type {string} */ v) => void store.set(k, v) };
    const register = () => registrationLimited(new Request(`${ORIGIN}/register`, { method: "POST", headers: { "CF-Connecting-IP": "192.0.2.1" } }), kv, 0);
    for (let i = 0; i < 5; i++) assert.equal(await register(), null);
    assert.equal((await register())?.status, 429);
  });
});

test("describeRedirect: a loopback host or an app's own scheme is an app on this computer; a web host is not", () => {
  assert.deepEqual(describeRedirect("http://127.0.0.1:53682/callback"), { host: "127.0.0.1", local: true, warning: describeRedirect("cursor://cb").warning });
  assert.equal(describeRedirect("cursor://anysphere.cursor-retrieval/oauth").host, "cursor://");
  assert.ok(describeRedirect("http://[::1]/cb").local);
  assert.deepEqual(describeRedirect("https://claude.ai/api/mcp/auth_callback"), { host: "claude.ai", local: false, warning: null });
  assert.equal(describeRedirect("https://localhost.example.com/cb").local, false);
});
