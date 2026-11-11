import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";

import { fromBase64url } from "../encoding.mjs";
import { githubAppJwt, signJwt } from "../jwt.mjs";

/** The header, claims and a verify of a compact JWT against `publicKey` (a node KeyObject's SPKI PEM). */
async function opened(token, publicPem, algorithm) {
  const [head, body, signature] = token.split(".");
  const spki = Uint8Array.from(atob(publicPem.replace(/-----[A-Z ]+-----|\s/g, "")), (c) =>
    c.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey("spki", spki, algorithm.importAs, false, ["verify"]);
  const ok = await crypto.subtle.verify(
    algorithm.verifyAs,
    key,
    fromBase64url(signature),
    new TextEncoder().encode(`${head}.${body}`),
  );
  const json = (part) => JSON.parse(new TextDecoder().decode(fromBase64url(part)));
  return { header: json(head), claims: json(body), ok };
}

test("signJwt signs RS256 with a PKCS#1 key as GitHub hands it out, and ES256 with a PKCS#8 key", async () => {
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pkcs1 = rsa.privateKey.export({ type: "pkcs1", format: "pem" });
  const rsaPublic = rsa.publicKey.export({ type: "spki", format: "pem" });
  const app = await opened(await githubAppJwt("12345", pkcs1, 1_700_000_000_000), rsaPublic, {
    importAs: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    verifyAs: { name: "RSASSA-PKCS1-v1_5" },
  });
  assert.equal(app.ok, true);
  assert.deepEqual(app.header, { alg: "RS256" });
  assert.deepEqual(app.claims, { iss: "12345", iat: 1_699_999_940, exp: 1_700_000_540 });

  const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
  // As a secret often holds it: one line with literal \n sequences.
  const pkcs8 = ec.privateKey.export({ type: "pkcs8", format: "pem" }).replace(/\n/g, "\\n");
  const ecPublic = ec.publicKey.export({ type: "spki", format: "pem" });
  const token = await signJwt({
    alg: "ES256",
    key: pkcs8,
    header: { kid: "K1" },
    claims: { sub: "x" },
    ttlSeconds: 60,
    now: 100,
  });
  const vapid = await opened(token, ecPublic, {
    importAs: { name: "ECDSA", namedCurve: "P-256" },
    verifyAs: { name: "ECDSA", hash: "SHA-256" },
  });
  assert.equal(vapid.ok, true);
  assert.deepEqual(vapid.header, { alg: "ES256", kid: "K1" });
  assert.deepEqual(vapid.claims, { iat: 100, exp: 160, sub: "x" });
});
