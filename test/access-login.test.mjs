// The Access for SaaS sign-in: settings, the authorization URL, the ID token checks, and the code exchange against a
// fake token endpoint and a key pair made here. PLANT tests are the ones that fail if the guard they name is removed.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";

import { accessSaas, authorizationUrl, finishSignIn, newSignIn, verifyIdToken } from "../access-login.mjs";

const ENV = {
  ACCESS_TEAM_DOMAIN: "https://sample.cloudflareaccess.com/",
  ACCESS_SAAS_CLIENT_ID: "client-1",
  ACCESS_SAAS_CLIENT_SECRET: "secret-1",
};
const saas = /** @type {NonNullable<ReturnType<typeof accessSaas>>} */ (accessSaas(ENV));

/** @param {Uint8Array} bytes */
const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
/** @param {unknown} value */
const encode = (value) => b64url(new TextEncoder().encode(JSON.stringify(value)));

const keyParams = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
const pair = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey(keyParams, true, ["sign", "verify"]));
const other = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey(keyParams, true, ["sign", "verify"]));
const publicJwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1" };
/** @type {import("../access-login.d.mts").KeySource} */
const keys = async (kid) => (kid === "k1" ? publicJwk : undefined);

const now = Math.floor(Date.now() / 1000);
/** @param {Record<string, unknown>} [over] */
const claims = (over = {}) => ({ iss: saas.issuer, aud: saas.clientId, exp: now + 300, nonce: "n1", email: "admin@example.com", ...over });

/** @param {unknown} payload @param {CryptoKey} [key] @param {Record<string, unknown>} [header] */
async function sign(payload, key = pair.privateKey, header = { alg: "RS256", kid: "k1" }) {
  const input = `${encode(header)}.${encode(payload)}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

describe("accessSaas", () => {
  test("derives every endpoint from the team domain and client id", () => {
    assert.equal(saas.issuer, "https://sample.cloudflareaccess.com/cdn-cgi/access/sso/oidc/client-1");
    assert.equal(saas.authorizationUrl, `${saas.issuer}/authorization`);
    assert.equal(saas.tokenUrl, `${saas.issuer}/token`);
    assert.equal(saas.jwksUrl, `${saas.issuer}/jwks`);
  });

  test("PLANT: any missing setting keeps the door shut", () => {
    assert.equal(accessSaas({ ...ENV, ACCESS_SAAS_CLIENT_SECRET: " " }), null);
    assert.equal(accessSaas({ ...ENV, ACCESS_TEAM_DOMAIN: undefined }), null);
    assert.equal(accessSaas({ ...ENV, ACCESS_SAAS_CLIENT_ID: "" }), null);
    assert.equal(accessSaas({}), null);
  });
});

describe("verifyIdToken", () => {
  const expect = { issuer: saas.issuer, audience: saas.clientId };

  test("accepts a token signed by the app's key, for this client, in date", async () => {
    assert.equal((await verifyIdToken(await sign(claims()), keys, expect))?.email, "admin@example.com");
    assert.ok(await verifyIdToken(await sign(claims({ aud: ["other", saas.clientId] })), keys, expect));
  });

  test("PLANT: a token signed by another key is refused", async () => {
    assert.equal(await verifyIdToken(await sign(claims(), other.privateKey), keys, expect), null);
  });

  test("PLANT: another issuer, another audience, or expired is refused", async () => {
    assert.equal(await verifyIdToken(await sign(claims({ iss: "https://evil.example.com" })), keys, expect), null);
    assert.equal(await verifyIdToken(await sign(claims({ aud: "client-2" })), keys, expect), null);
    assert.equal(await verifyIdToken(await sign(claims({ exp: now - 120 })), keys, expect), null);
    assert.equal(await verifyIdToken(await sign(claims({ exp: undefined })), keys, expect), null);
  });

  test("allows 60 seconds of clock skew either way, and no more", async () => {
    assert.ok(await verifyIdToken(await sign(claims({ exp: now - 30 })), keys, expect));
    assert.ok(await verifyIdToken(await sign(claims({ nbf: now + 30 })), keys, expect));
    assert.equal(await verifyIdToken(await sign(claims({ nbf: now + 120 })), keys, expect), null);
    assert.equal(await verifyIdToken(await sign(claims({ nbf: "soon" })), keys, expect), null);
  });

  test("PLANT: alg none, HS256 or a missing kid is refused", async () => {
    const unsigned = `${encode({ alg: "none", kid: "k1" })}.${encode(claims())}.`;
    assert.equal(await verifyIdToken(unsigned, keys, expect), null);
    assert.equal(await verifyIdToken(await sign(claims(), pair.privateKey, { alg: "HS256", kid: "k1" }), keys, expect), null);
    assert.equal(await verifyIdToken(await sign(claims(), pair.privateKey, { alg: "RS256" }), keys, expect), null);
  });

  test("garbage is refused, not thrown", async () => {
    for (const token of ["", "a.b", "a.b.c", "!!.!!.!!", `${encode({ alg: "RS256", kid: "k1" })}.${encode([1])}.x`]) {
      assert.equal(await verifyIdToken(token, keys, expect), null);
    }
  });

  test("an unknown kid refetches once, so a rotated key is found", async () => {
    /** @type {boolean[]} */
    const asked = [];
    /** @type {import("../access-login.d.mts").KeySource} */
    const rotating = async (_kid, fresh) => {
      asked.push(fresh);
      return fresh ? publicJwk : undefined;
    };
    assert.ok(await verifyIdToken(await sign(claims()), rotating, expect));
    assert.deepEqual(asked, [false, true]);
  });
});

describe("newSignIn and authorizationUrl", () => {
  test("each sign-in gets its own verifier and nonce, and the verifier is 43 URL-safe characters", () => {
    const a = newSignIn();
    const b = newSignIn();
    assert.notEqual(a.verifier, b.verifier);
    assert.notEqual(a.nonce, b.nonce);
    assert.match(a.verifier, /^[A-Za-z0-9_-]{43}$/);
  });

  test("the URL carries the client, the redirect, the state, the nonce and the S256 challenge, never the verifier", async () => {
    const { verifier, nonce } = newSignIn();
    const url = new URL(await authorizationUrl(saas, { redirectUri: "https://mcp.example.com/callback", state: "s1", verifier, nonce }));
    assert.equal(url.origin + url.pathname, saas.authorizationUrl);
    assert.equal(url.searchParams.get("client_id"), "client-1");
    assert.equal(url.searchParams.get("redirect_uri"), "https://mcp.example.com/callback");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("scope"), "openid email profile");
    assert.equal(url.searchParams.get("state"), "s1");
    assert.equal(url.searchParams.get("nonce"), nonce);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    assert.equal(url.searchParams.get("code_challenge"), challenge);
    assert.ok(!url.href.includes(verifier));
  });
});

describe("finishSignIn", () => {
  const realFetch = globalThis.fetch;
  /** @type {URLSearchParams[]} */
  let exchanges = [];
  /** @type {() => Promise<Response>} */
  let tokenEndpoint;
  const input = { code: "c1", redirectUri: "https://mcp.example.com/callback", verifier: "v1", nonce: "n1" };

  beforeEach(() => {
    exchanges = [];
    tokenEndpoint = async () => Response.json({ id_token: await sign(claims()) });
    globalThis.fetch = /** @type {typeof fetch} */ (
      async (url, init) => {
        assert.equal(String(url), saas.tokenUrl);
        exchanges.push(new URLSearchParams(String(init?.body)));
        return tokenEndpoint();
      }
    );
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("exchanges the code with the verifier and the client secret, and returns the verified email", async () => {
    assert.deepEqual(await finishSignIn(saas, input, keys), { ok: true, email: "admin@example.com" });
    const sent = exchanges[0];
    assert.equal(sent.get("grant_type"), "authorization_code");
    assert.equal(sent.get("code"), "c1");
    assert.equal(sent.get("redirect_uri"), input.redirectUri);
    assert.equal(sent.get("code_verifier"), "v1");
    assert.equal(sent.get("client_id"), "client-1");
    assert.equal(sent.get("client_secret"), "secret-1");
  });

  test("returns the name too, trimmed and cut to 80 characters", async () => {
    tokenEndpoint = async () => Response.json({ id_token: await sign(claims({ name: `  ${"n".repeat(100)} ` })) });
    assert.deepEqual(await finishSignIn(saas, input, keys), { ok: true, email: "admin@example.com", name: "n".repeat(80) });
  });

  test("PLANT: another nonce, an unverified email or no email is refused", async () => {
    /** @type {[Record<string, unknown>, string][]} */
    const cases = [
      [{ nonce: "replayed" }, "nonce-mismatch"],
      [{ email_verified: false }, "email-not-verified"],
      [{ email: "  " }, "no-email"],
    ];
    for (const [over, reason] of cases) {
      tokenEndpoint = async () => Response.json({ id_token: await sign(claims(over)) });
      assert.deepEqual(await finishSignIn(saas, input, keys), { ok: false, reason });
    }
  });

  test("PLANT: a token signed by another key is refused", async () => {
    tokenEndpoint = async () => Response.json({ id_token: await sign(claims(), other.privateKey) });
    assert.deepEqual(await finishSignIn(saas, input, keys), { ok: false, reason: "invalid-id-token" });
  });

  test("a failed exchange or an answer with no ID token is a refusal, not a throw", async () => {
    tokenEndpoint = async () => new Response("busy", { status: 503 });
    assert.deepEqual(await finishSignIn(saas, input, keys), { ok: false, reason: "token-exchange-503" });
    tokenEndpoint = async () => new Response("not json");
    assert.deepEqual(await finishSignIn(saas, input, keys), { ok: false, reason: "no-id-token" });
  });
});
