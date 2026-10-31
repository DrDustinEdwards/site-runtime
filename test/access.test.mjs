// The Access request-token check: the team domain, where the token is read from, each refusal by its reason, and the
// key fetch against a fake certs endpoint, with a key pair made here. PLANT tests are the ones that fail if the guard
// they name is removed.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";

import { ACCESS_COOKIE, ACCESS_JWT_HEADER, ACCESS_LOGOUT_PATH, ADMIN_SEEN_COOKIE, BACKGROUND_HEADER, REFETCH_COOLDOWN_MS, accessAdmin, adminIdle, accessIssuer, accessKeys, accessToken, adminEmails, verifyAccessRequest } from "../access.mjs";
import { encode, other, pair, publicJwk, keys, sign } from "./jwt.mjs";

const TEAM = "sample.cloudflareaccess.com";
const ISSUER = `https://${TEAM}`;
const AUD = "aud-tag-1";

const now = Math.floor(Date.now() / 1000);
/** Access's request token: aud is an array of application tags; a person has an email, a service token a common_name. */
/** @param {Record<string, unknown>} [over] */
const claims = (over = {}) => ({ iss: ISSUER, aud: [AUD], exp: now + 300, iat: now, email: "admin@example.com", ...over });


/** @param {Record<string, string>} headers */
const request = (headers = {}) => new Request("https://example.com/admin", { headers });
const config = { teamDomain: TEAM, audience: AUD, keys };

describe("accessIssuer", () => {
  test("is https://<team domain> with no trailing slash, whichever way the domain is kept", () => {
    for (const domain of [TEAM, `${TEAM}/`, `https://${TEAM}`, `https://${TEAM}//`, `  ${TEAM} `, "Sample.CloudflareAccess.com"]) {
      assert.equal(accessIssuer(domain), ISSUER);
    }
  });

  test("a missing domain, one that is not a bare host, or one off cloudflareaccess.com is null", () => {
    for (const domain of [undefined, "", "  ", "https://", `${TEAM}/cdn-cgi`, `http://${TEAM}`, "team domain", "attacker.example", "sample.cloudflareaccess.com.attacker.example"]) {
      assert.equal(accessIssuer(domain), null);
    }
  });
});

describe("accessToken", () => {
  const token = "h.p.s";
  test("reads the header, and the cookie only when asked", () => {
    assert.equal(accessToken(request({ [ACCESS_JWT_HEADER]: token })), token);
    assert.equal(accessToken(request({ cookie: `a=1; ${ACCESS_COOKIE}=${token}; b=2` })), null);
    assert.equal(accessToken(request({ cookie: `a=1; ${ACCESS_COOKIE}=${token}; b=2` }), { cookie: true }), token);
  });

  test("the header wins over the cookie, and an empty cookie or one with a longer name is no token", () => {
    assert.equal(accessToken(request({ [ACCESS_JWT_HEADER]: "header", cookie: `${ACCESS_COOKIE}=cookie` }), { cookie: true }), "header");
    assert.equal(accessToken(request({ cookie: `${ACCESS_COOKIE}=` }), { cookie: true }), null);
    assert.equal(accessToken(request({ cookie: `X${ACCESS_COOKIE}=${token}` }), { cookie: true }), null);
  });
});

describe("verifyAccessRequest", () => {
  test("returns the claims of a token Access signed for this application", async () => {
    const verdict = await verifyAccessRequest(request({ [ACCESS_JWT_HEADER]: await sign(claims()) }), config);
    assert.equal(verdict.ok && verdict.claims.email, "admin@example.com");
    const service = await verifyAccessRequest(request({ [ACCESS_JWT_HEADER]: await sign(claims({ email: undefined, common_name: "svc.access" })) }), config);
    assert.equal(service.ok && service.claims.common_name, "svc.access");
    const single = await verifyAccessRequest(request({ [ACCESS_JWT_HEADER]: await sign(claims({ aud: AUD })) }), config);
    assert.equal(single.ok, true);
  });

  test("reads the CF_Authorization cookie only when the caller asks", async () => {
    const cookie = `${ACCESS_COOKIE}=${await sign(claims())}`;
    assert.deepEqual(await verifyAccessRequest(request({ cookie }), config), { ok: false, reason: "no-token" });
    assert.equal((await verifyAccessRequest(request({ cookie }), { ...config, cookie: true })).ok, true);
  });

  test("PLANT: a missing setting keeps the door shut", async () => {
    const req = request({ [ACCESS_JWT_HEADER]: await sign(claims()) });
    assert.deepEqual(await verifyAccessRequest(req, { ...config, teamDomain: undefined }), { ok: false, reason: "not-configured" });
    assert.deepEqual(await verifyAccessRequest(req, { ...config, audience: " " }), { ok: false, reason: "not-configured" });
  });

  test("no token is no-token", async () => {
    assert.deepEqual(await verifyAccessRequest(request(), config), { ok: false, reason: "no-token" });
  });

  test("PLANT: each fault in the token is refused with its reason", async () => {
    /** @type {[string, string][]} */
    const cases = [
      [await sign(claims(), other.privateKey), "signature"],
      [await sign(claims({ iss: "https://other.cloudflareaccess.com" })), "issuer"],
      [await sign(claims({ iss: `${ISSUER}/` })), "issuer"],
      [await sign(claims({ aud: ["another-app"] })), "audience"],
      [await sign(claims({ exp: now - 120 })), "expired"],
      [await sign(claims({ exp: undefined })), "expired"],
      [await sign(claims({ nbf: now + 120 })), "not-yet-valid"],
      [`${encode({ alg: "none", kid: "k1" })}.${encode(claims())}.`, "algorithm"],
      [await sign(claims(), pair.privateKey, { alg: "HS256", kid: "k1" }), "algorithm"],
      [await sign(claims(), pair.privateKey, { alg: "RS256", kid: "k9" }), "unknown-key"],
      [await sign(claims(), pair.privateKey, { alg: "RS256" }), "unknown-key"],
      ["not-a-jwt", "malformed"],
      ["!!.!!.!!", "malformed"],
      [`${encode({ alg: "RS256", kid: "k1" })}.${encode([1])}.x`, "malformed"],
    ];
    for (const [token, reason] of cases) {
      assert.deepEqual(await verifyAccessRequest(request({ [ACCESS_JWT_HEADER]: token }), config), { ok: false, reason }, reason);
    }
  });

  test("allows 60 seconds of clock skew either way, and no more", async () => {
    const at = async (/** @type {Record<string, unknown>} */ over) => (await verifyAccessRequest(request({ [ACCESS_JWT_HEADER]: await sign(claims(over)) }), config)).ok;
    assert.equal(await at({ exp: now - 30 }), true);
    assert.equal(await at({ nbf: now + 30 }), true);
    assert.equal(await at({ exp: now - 90 }), false);
    assert.equal(await at({ nbf: now + 90 }), false);
  });

  test("`now` sets the clock, in milliseconds", async () => {
    const req = request({ [ACCESS_JWT_HEADER]: await sign(claims()) });
    assert.deepEqual(await verifyAccessRequest(req, { ...config, now: (now + 600) * 1000 }), { ok: false, reason: "expired" });
  });
});

describe("accessKeys", () => {
  const realFetch = globalThis.fetch;
  /** @type {string[]} */
  let fetched = [];
  /** @type {() => Response | Promise<Response>} */
  let certs;
  let team = 0;
  /** A team domain no other test has used, so the isolate cache starts empty. */
  const freshTeam = () => `team-${++team}.cloudflareaccess.com`;

  beforeEach(() => {
    fetched = [];
    certs = () => Response.json({ keys: [publicJwk] });
    globalThis.fetch = /** @type {typeof fetch} */ (
      async (url) => {
        fetched.push(String(url));
        return certs();
      }
    );
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("fetches https://<team>/cdn-cgi/access/certs once and caches it", async () => {
    const domain = freshTeam();
    const source = accessKeys(`https://${domain}/`);
    assert.equal((await source("k1", false))?.kid, "k1");
    assert.equal((await accessKeys(domain)("k1", false))?.kid, "k1");
    assert.deepEqual(fetched, [`https://${domain}/cdn-cgi/access/certs`]);
  });

  test("verifies a request end to end through the fetched keys", async () => {
    const domain = freshTeam();
    const token = await sign(claims({ iss: `https://${domain}` }));
    const verdict = await verifyAccessRequest(request({ [ACCESS_JWT_HEADER]: token }), { teamDomain: domain, audience: AUD });
    assert.equal(verdict.ok, true);
  });

  test("PLANT: an unavailable key set throws, never a refusal", async () => {
    const domain = freshTeam();
    const token = await sign(claims({ iss: `https://${domain}` }));
    const req = () => request({ [ACCESS_JWT_HEADER]: token });
    certs = () => new Response("down", { status: 503 });
    await assert.rejects(verifyAccessRequest(req(), { teamDomain: domain, audience: AUD }), /answered 503/);
    certs = () => new Response("<html>");
    await assert.rejects(verifyAccessRequest(req(), { teamDomain: domain, audience: AUD }), /not a key set/);
    certs = () => Promise.reject(new TypeError("fetch failed"));
    await assert.rejects(verifyAccessRequest(req(), { teamDomain: domain, audience: AUD }), /fetch failed/);
  });

  test("PLANT: within the cooldown a forged kid does not refetch, however many tokens name it", async () => {
    const domain = freshTeam();
    const source = accessKeys(domain);
    assert.equal((await source("k1", false))?.kid, "k1");
    for (let i = 0; i < 5; i++) assert.equal(await source(`forged-${i}`, true), undefined);
    assert.equal(fetched.length, 1);
  });

  test("PLANT: after the cooldown an unknown kid refetches and the rotated key is found", async (t) => {
    const domain = freshTeam();
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    certs = () => Response.json({ keys: [] });
    const source = accessKeys(domain);
    assert.equal(await source("k1", false), undefined);
    t.mock.timers.tick(REFETCH_COOLDOWN_MS);
    certs = () => Response.json({ keys: [publicJwk] });
    assert.equal((await source("k1", true))?.kid, "k1");
    assert.equal(fetched.length, 2);
  });

  test("a team domain that is not a host throws, since no key set can be named for it", () => {
    assert.throws(() => accessKeys(""), /team domain/);
  });
});

describe("accessAdmin", () => {
  const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAIL: " Admin@Example.com, second@example.com" };
  test("passes a listed email in any case, and nobody else", async () => {
    const token = await sign(claims({ email: "ADMIN@example.com" }));
    assert.deepEqual(await accessAdmin(request({ [ACCESS_JWT_HEADER]: token }), env, { keys }), { email: "admin@example.com" });
    assert.equal(await accessAdmin(request({ cookie: `${ACCESS_COOKIE}=${token}` }), env, { keys, admins: ["someone@example.com"] }), null);
    assert.equal(await accessAdmin(request({ [ACCESS_JWT_HEADER]: token }), { ...env, ADMIN_EMAIL: "" }, { keys }), null);
    assert.deepEqual(adminEmails({ ADMIN_EMAILS: "A@example.com,,b@example.com ", ADMIN_EMAIL: "c@example.com" }), ["a@example.com", "b@example.com"]);
  });

  test("PLANT: the development bypass opens localhost only, and keys that cannot be fetched refuse", async () => {
    const bypass = { ...env, ACCESS_DEV_BYPASS: "1" };
    assert.deepEqual(await accessAdmin(new Request("http://localhost:5173/admin"), bypass), { email: "admin@example.com" });
    assert.equal(await accessAdmin(new Request("https://example.com/admin"), bypass, { keys }), null);
    const logged = console.error;
    console.error = () => {};
    const down = async () => { throw new Error("certs unreachable"); };
    const verdict = await accessAdmin(request({ [ACCESS_JWT_HEADER]: await sign(claims()) }), env, { keys: down });
    console.error = logged;
    assert.equal(verdict, null);
  });
});

test("PLANT: an admin idle past the hour is sent to Access's logout; the seen cookie counts only for its own token", async () => {
  const token = await sign(claims({ iat: now - 5400 }));
  const at = (cookie) => new Request("https://example.com/admin", { headers: { cookie } });
  const log = console.log;
  console.log = () => {};
  const stale = await adminIdle(at(`${ACCESS_COOKIE}=${token}`), { now: now * 1000 });
  console.log = log;
  assert.equal(stale.idle && stale.response.headers.get("location"), ACCESS_LOGOUT_PATH);
  // A request 30 minutes ago, recorded for this token, keeps the session; its cookie does nothing for another token.
  const earlier = await adminIdle(at(`${ACCESS_COOKIE}=${await sign(claims({ iat: now - 3600 }))}`), { now: (now - 1800) * 1000 });
  const fresh = await adminIdle(at(`${ACCESS_COOKIE}=${token}`), { now: (now - 1800) * 1000 });
  const seen = /** @type {{ cookie: string }} */ (fresh).cookie.split(";")[0];
  assert.equal((await adminIdle(at(`${ACCESS_COOKIE}=${token}; ${seen}`), { now: now * 1000 })).idle, false);
  console.log = () => {};
  const copied = await adminIdle(at(`${ACCESS_COOKIE}=${token}; ${/** @type {{ cookie: string }} */ (earlier).cookie.split(";")[0]}`), { now: now * 1000 });
  console.log = log;
  assert.equal(copied.idle, true);
  assert.ok(seen.startsWith(`${ADMIN_SEEN_COOKIE}=`));
});

test("PLANT: a background request is timed but does not keep the admin awake; a host's own session is timed like a token", async () => {
  const token = await sign(claims({ iat: now - 1800 }));
  const poll = new Request("https://example.com/admin/feed", { headers: { cookie: `${ACCESS_COOKIE}=${token}`, [BACKGROUND_HEADER]: "1" } });
  assert.deepEqual(await adminIdle(poll, { now: now * 1000 }), { idle: false });
  const prefetch = new Request("https://example.com/admin", { headers: { cookie: `${ACCESS_COOKIE}=${token}`, "sec-purpose": "prefetch;prerender" } });
  assert.deepEqual(await adminIdle(prefetch, { now: now * 1000 }), { idle: false });
  // No Access token: the session the host hands in is what is timed, and its seen cookie is good for it alone.
  const session = { id: "opaque-1", signedInAt: (now - 5400) * 1000 };
  const bare = (cookie = "") => new Request("https://portal.example.com/", { headers: { cookie } });
  const fresh = await adminIdle(bare(), { session, now: (now - 1800) * 1000 });
  const seen = /** @type {{ cookie: string }} */ (fresh).cookie.split(";")[0];
  assert.equal((await adminIdle(bare(seen), { session, now: now * 1000 })).idle, false);
  const log = console.log;
  console.log = () => {};
  const other = await adminIdle(bare(seen), { session: { ...session, id: "opaque-2" }, now: now * 1000 });
  console.log = log;
  assert.equal(other.idle, true);
  // A second Access app's check keeps its own cookie, so this one's is left alone.
  const lab = await adminIdle(bare(), { session, now: (now - 1800) * 1000, cookieName: "__Host-lab-seen" });
  assert.ok(/** @type {{ cookie: string }} */ (lab).cookie.startsWith("__Host-lab-seen="));
});
