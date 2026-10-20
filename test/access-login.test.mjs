// The Access for SaaS sign-in: settings, the ID token checks, and the whole round trip against a fake store, a
// fake token endpoint and a key pair made here. PLANT tests are the ones that fail if the guard they name is removed.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";

import { accessSaas, clearStateCookie, completeAccessLogin, NOT_CONFIGURED, startAccessLogin, STATE_TTL_SECONDS, verifyIdToken } from "../access-login.mjs";

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

// A store that keeps what it is given, as a KV namespace would.
function memoryStore() {
  /** @type {Map<string, string>} */
  const map = new Map();
  /** @type {number[]} */
  const ttls = [];
  return {
    map,
    ttls,
    get: async (/** @type {string} */ k) => map.get(k) ?? null,
    put: async (/** @type {string} */ k, /** @type {string} */ v, /** @type {{ expirationTtl: number }} */ o) => {
      map.set(k, v);
      ttls.push(o.expirationTtl);
    },
    delete: async (/** @type {string} */ k) => {
      map.delete(k);
    },
  };
}

const FLOW = {
  callbackPath: "/callback",
  stateCookie: "sample_login",
  cookiePath: "/callback",
  kvPrefix: "login:",
  restartHint: "Start again from your client.",
  deniedMessage: "access denied: not the administrator",
};
const ORIGIN = "https://mcp.example.com";

describe("the sign-in round trip", () => {
  const realFetch = globalThis.fetch;
  /** @type {URLSearchParams[]} */
  let exchanges = [];
  /** @type {(body: URLSearchParams) => Promise<Response>} */
  let tokenEndpoint;

  beforeEach(() => {
    exchanges = [];
    tokenEndpoint = async (body) => Response.json({ id_token: await sign(claims({ nonce: lastNonce })) });
    globalThis.fetch = /** @type {typeof fetch} */ (
      async (input, init) => {
        assert.equal(String(input), saas.tokenUrl);
        const body = new URLSearchParams(String(init?.body));
        exchanges.push(body);
        return tokenEndpoint(body);
      }
    );
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  let lastNonce = "";
  /** Starts a sign-in and returns what the browser and Access would carry back. */
  async function start(store = memoryStore(), stored = "the caller's own value") {
    const res = await startAccessLogin(new Request(`${ORIGIN}/authorize`, { method: "POST" }), { saas, store, flow: FLOW, stored });
    const location = new URL(/** @type {string} */ (res.headers.get("Location")));
    lastNonce = /** @type {string} */ (location.searchParams.get("nonce"));
    const setCookie = /** @type {string} */ (res.headers.get("Set-Cookie"));
    const binding = setCookie.split(";")[0].split("=")[1];
    const state = /** @type {string} */ (location.searchParams.get("state"));
    return { res, location, setCookie, binding, state, store };
  }
  /** @param {string} state @param {string | null} binding @param {string} [query] */
  const callback = (state, binding, query = `code=c1&state=${state}`) =>
    new Request(`${ORIGIN}/callback?${query}`, { headers: binding === null ? {} : { Cookie: `other=1; ${FLOW.stateCookie}=${binding}` } });
  const complete = (/** @type {Request} */ req, /** @type {ReturnType<typeof memoryStore>} */ store, isAllowed = (/** @type {string} */ e) => e === "admin@example.com") =>
    completeAccessLogin(req, { saas, store, flow: FLOW, isAllowed, keys });

  test("start sends the browser to Access with PKCE S256, a nonce and a state, and keeps all three on the server", async () => {
    const { res, location, setCookie, binding, state, store } = await start();
    assert.equal(res.status, 302);
    assert.equal(location.origin + location.pathname, saas.authorizationUrl);
    assert.equal(location.searchParams.get("client_id"), "client-1");
    assert.equal(location.searchParams.get("redirect_uri"), `${ORIGIN}/callback`);
    assert.equal(location.searchParams.get("code_challenge_method"), "S256");
    assert.equal(location.searchParams.get("scope"), "openid email profile");
    assert.match(setCookie, /HttpOnly; Secure; SameSite=Lax; Path=\/callback; Max-Age=600$/);
    assert.deepEqual(store.ttls, [STATE_TTL_SECONDS]);
    const kept = JSON.parse(/** @type {string} */ (store.map.get(`login:${state}`)));
    assert.equal(kept.stored, "the caller's own value");
    assert.equal(kept.nonce, lastNonce);
    // PLANT: the verifier never leaves the server, and the cookie is not the stored binding.
    assert.ok(!location.href.includes(kept.verifier));
    assert.ok(!setCookie.includes(kept.verifier));
    assert.notEqual(binding, kept.binding);
    assert.ok(!binding.includes(state));
  });

  test("a whole sign-in admits the allowed email once, and the state is gone after", async () => {
    const { binding, state, store } = await start();
    const result = await complete(callback(state, binding), store);
    assert.equal(result.ok, true);
    assert.ok(result.ok && result.email === "admin@example.com" && result.state === "the caller's own value");
    assert.equal(exchanges[0].get("code"), "c1");
    assert.equal(exchanges[0].get("redirect_uri"), `${ORIGIN}/callback`);
    assert.equal(store.map.size, 0);
    const again = await complete(callback(state, binding), store);
    assert.equal(again.ok, false);
    assert.ok(!again.ok && again.response.status === 403);
  });

  test("the verifier sent to the token endpoint is the one whose challenge went to Access", async () => {
    const { location, binding, state, store } = await start();
    await complete(callback(state, binding), store);
    const verifier = /** @type {string} */ (exchanges[0].get("code_verifier"));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    assert.equal(location.searchParams.get("code_challenge"), challenge);
  });

  test("PLANT: no cookie, or another browser's cookie, is refused and leaves the state for its own browser", async () => {
    const { binding, state, store } = await start();
    for (const presented of [null, "0".repeat(64), `${binding}x`]) {
      const result = await complete(callback(state, presented), store);
      assert.ok(!result.ok && result.response.status === 403);
      assert.match(await result.response.text(), /did not start the sign-in/);
    }
    assert.equal(exchanges.length, 0);
    assert.equal(store.map.size, 1);
    assert.equal((await complete(callback(state, binding), store)).ok, true);
  });

  test("PLANT: a state that was never stored, or expired, is refused before Access is asked", async () => {
    const { binding, store } = await start();
    const result = await complete(callback(crypto.randomUUID(), binding), store);
    assert.ok(!result.ok && result.response.status === 403);
    assert.equal(exchanges.length, 0);
  });

  test("an email isAllowed refuses is the flow's denial", async () => {
    const { binding, state, store } = await start();
    const result = await complete(callback(state, binding), store, () => false);
    assert.ok(!result.ok && result.response.status === 403);
    assert.equal(await result.response.text(), FLOW.deniedMessage);
  });

  test("PLANT: a token with another nonce, an unverified email or no email is refused", async () => {
    for (const over of [{ nonce: "replayed" }, { email_verified: false }, { email: "  " }]) {
      const { binding, state, store } = await start();
      tokenEndpoint = async () => Response.json({ id_token: await sign(claims({ nonce: lastNonce, ...over })) });
      const result = await complete(callback(state, binding), store);
      assert.ok(!result.ok && result.response.status === 403, JSON.stringify(over));
    }
  });

  test("a failed exchange keeps the state, so the person can retry the same sign-in", async () => {
    const { binding, state, store } = await start();
    tokenEndpoint = async () => new Response("busy", { status: 503 });
    const failed = await complete(callback(state, binding), store);
    assert.ok(!failed.ok && failed.response.status === 502);
    assert.equal(store.map.size, 1);
    tokenEndpoint = async () => Response.json({});
    const empty = await complete(callback(state, binding), store);
    assert.ok(!empty.ok && empty.response.status === 502);
  });

  test("Access's own refusal is named, and a missing code is a 400", async () => {
    const { binding, state, store } = await start();
    const refused = await complete(callback(state, binding, "error=access_denied"), store);
    assert.ok(!refused.ok && refused.response.status === 403);
    assert.match(await refused.response.text(), /refused by Access: access_denied/);
    const missing = await complete(callback(state, binding, `state=${state}`), store);
    assert.ok(!missing.ok && missing.response.status === 400);
  });

  test("an unreadable stored state, or one parse refuses, is deleted and refused", async () => {
    const { binding, state, store } = await start();
    const thrown = await completeAccessLogin(callback(state, binding), {
      saas,
      store,
      flow: FLOW,
      isAllowed: () => true,
      keys,
      parse: () => {
        throw new Error("bad");
      },
    });
    assert.ok(!thrown.ok && thrown.response.status === 403);
    assert.equal(store.map.size, 0);
    store.map.set("login:junk", "{not json");
    const junk = await complete(callback("junk", binding), store);
    assert.ok(!junk.ok && junk.response.status === 403);
    assert.equal(store.map.has("login:junk"), false);
  });

  test("the name is returned, trimmed and cut to 80 characters", async () => {
    const { binding, state, store } = await start();
    tokenEndpoint = async () => Response.json({ id_token: await sign(claims({ nonce: lastNonce, name: `  ${"n".repeat(100)} ` })) });
    const result = await complete(callback(state, binding), store);
    assert.ok(result.ok && result.name === "n".repeat(80));
  });

  test("PLANT: an unconfigured sign-in is closed at both ends", async () => {
    const store = memoryStore();
    const started = await startAccessLogin(new Request(`${ORIGIN}/authorize`), { saas: null, store, flow: FLOW, stored: "x" });
    assert.equal(started.status, 503);
    assert.equal(await started.text(), NOT_CONFIGURED);
    assert.equal(store.map.size, 0);
    const done = await completeAccessLogin(callback("s", "b"), { saas: null, store, flow: FLOW, isAllowed: () => true });
    assert.ok(!done.ok && done.response.status === 503);
  });

  test("clearStateCookie expires the binding cookie on its own path", () => {
    assert.equal(clearStateCookie(FLOW), "sample_login=; HttpOnly; Secure; SameSite=Lax; Path=/callback; Max-Age=0");
  });
});
