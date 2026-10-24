// The Apple client secret: a JWT Apple's own check would take, made from a key generated here.
import assert from "node:assert/strict";
import { test } from "node:test";

import { appleClientSecret } from "../apple-secret.mjs";

const pair = /** @type {CryptoKeyPair} */ (
  await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])
);
const der = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
const pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)?.join("\n")}\n-----END PRIVATE KEY-----`;
const env = { APPLE_CLIENT_ID: "com.example.web", APPLE_TEAM_ID: "TEAM123456", APPLE_KEY_ID: "KEY1234567", APPLE_PRIVATE_KEY: pem };
const decode = (/** @type {string} */ part) => JSON.parse(Buffer.from(part, "base64url").toString());

test("PLANT: an ES256 JWT for Apple's audience, signed by the key, valid for 30 days", async () => {
  const jwt = /** @type {string} */ (await appleClientSecret(env, 1_000_000));
  const [header, claims, signature] = jwt.split(".");
  assert.deepEqual(decode(header), { alg: "ES256", kid: "KEY1234567" });
  assert.deepEqual(decode(claims), {
    iss: "TEAM123456",
    iat: 1_000_000,
    exp: 1_000_000 + 30 * 86_400,
    aud: "https://appleid.apple.com",
    sub: "com.example.web",
  });
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    pair.publicKey,
    Buffer.from(signature, "base64url"),
    new TextEncoder().encode(`${header}.${claims}`),
  );
  assert.equal(valid, true);
});

test("a key pasted with escaped newlines, as a dashboard secret often is, still signs", async () => {
  assert.ok(await appleClientSecret({ ...env, APPLE_PRIVATE_KEY: pem.replace(/\n/g, "\\n") }));
});

test("any setting missing: null, so the site offers no Apple button", async () => {
  assert.equal(await appleClientSecret({ ...env, APPLE_KEY_ID: "" }), null);
});
