// The consent step and the Access round trip, against a fake provider that records what the handler hands it and a
// fake Access (token endpoint and keys), and the registration allowlist. PLANT tests are the ones that fail if the
// guard they name is removed.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";

import { isAdminUser, loginHandler, registrationRefusal } from "../mcp-login.mjs";

const ORIGIN = "https://wrapper.test";
const TEAM = "https://sample.cloudflareaccess.com";
const ISSUER = `${TEAM}/cdn-cgi/access/sso/oidc/client-id`;
const AUTH_REQUEST = { clientId: "https://client.example.com/meta", redirectUri: "https://client.example.com/cb", scope: ["s.read", "s.write"], state: "s" };

const handler = loginHandler({ name: "Sample Admin", scopes: { read: "s.read", write: "s.write" }, about: "<p>Sample.</p>", admit: isAdminUser });

const pair = /** @type {CryptoKeyPair} */ (
  await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])
);
const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1" };
/** @param {Uint8Array} bytes */
const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
/** @param {unknown} value */
const encode = (value) => b64url(new TextEncoder().encode(JSON.stringify(value)));
/** @param {Record<string, unknown>} claims */
async function idToken(claims) {
  const input = `${encode({ alg: "RS256", kid: "k1" })}.${encode(claims)}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

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
  const form = new FormData();
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
    assert.deepEqual(seen.completed?.props, { email: "Admin@Example.com", scopes: ["s.read"] });
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

  test("PLANT: a near miss is refused, naming it", () => {
    for (const uri of [`${GEMINI}/`, `${GEMINI}?x=1`, "https://vertexaisearch.cloud.google.com/oauth", GEMINI.toUpperCase()]) {
      assert.match(registrationRefusal(LIST, { redirect_uris: [GEMINI, uri] }) ?? "", /not allowlisted/, uri);
    }
  });
});
