/**
 * Signing a JWT with WebCrypto alone, RS256 or ES256: the GitHub App's token request (RS256), a Google service
 * account's assertion (RS256), Sign in with Apple's client secret and VAPID (ES256). Each was hand-rolled in a site
 * (carrel, capsid) or reached for `jose`; this is the one signer, with no dependency.
 *
 * A key is a PEM (PKCS#8 "BEGIN PRIVATE KEY", or PKCS#1 "BEGIN RSA PRIVATE KEY" as GitHub hands out App keys, wrapped
 * here into PKCS#8 since WebCrypto imports PKCS#8 only), a private JWK, or a CryptoKey already imported. A PEM pasted
 * into a secret with literal "\n" sequences reads the same. WebCrypto's ECDSA signature is already JOSE's r || s.
 */

import { base64url, fromBase64 } from "./encoding.mjs";

/** How each algorithm's key is imported and how it signs. */
const ALGORITHMS = {
  RS256: {
    importAs: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    signAs: { name: "RSASSA-PKCS1-v1_5" },
  },
  ES256: {
    importAs: { name: "ECDSA", namedCurve: "P-256" },
    signAs: { name: "ECDSA", hash: "SHA-256" },
  },
};

/** @param {number} n */
function derLength(n) {
  if (n < 0x80) return [n];
  /** @type {number[]} */
  const bytes = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

/**
 * @param {number} tag
 * @param {ArrayLike<number>} content
 */
function der(tag, content) {
  const body = Array.from(content);
  return [tag, ...derLength(body.length), ...body];
}

/**
 * A PEM private key as PKCS#8 bytes. A PKCS#1 RSA key is wrapped with the rsaEncryption algorithm id, so a GitHub App
 * key is pasted as downloaded.
 * @param {string} pem
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function pkcs8FromPem(pem) {
  const text = pem.replace(/\\n/g, "\n");
  const bytes = fromBase64(text.replace(/-----(BEGIN|END) [A-Z ]+-----/g, ""));
  if (!/BEGIN RSA PRIVATE KEY/.test(text)) return /** @type {Uint8Array<ArrayBuffer>} */ (bytes);
  const version = der(0x02, [0x00]);
  // SEQUENCE { OID 1.2.840.113549.1.1.1 (rsaEncryption), NULL }
  const algorithm = der(
    0x30,
    [0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00],
  );
  return new Uint8Array(der(0x30, [...version, ...algorithm, ...der(0x04, bytes)]));
}

/**
 * @param {"RS256" | "ES256"} alg
 * @param {string | JsonWebKey | CryptoKey} key
 * @returns {Promise<CryptoKey>}
 */
async function signingKey(alg, key) {
  const algorithm = ALGORITHMS[alg].importAs;
  if (typeof key === "string")
    return crypto.subtle.importKey("pkcs8", pkcs8FromPem(key), algorithm, false, ["sign"]);
  if (typeof CryptoKey !== "undefined" && key instanceof CryptoKey) return key;
  return crypto.subtle.importKey("jwk", /** @type {JsonWebKey} */ (key), algorithm, false, [
    "sign",
  ]);
}

/**
 * A signed compact JWT. `header` adds fields such as `kid` or `typ` after `alg`. With `ttlSeconds`, `iat` and
 * `exp` are filled from `now` (seconds), unless `claims` sets them.
 * @param {{ alg: "RS256" | "ES256", key: string | JsonWebKey | CryptoKey, claims: Record<string, unknown>, header?: Record<string, unknown>, ttlSeconds?: number, now?: number }} options
 * @returns {Promise<string>}
 */
export async function signJwt({
  alg,
  key,
  claims,
  header = {},
  ttlSeconds,
  now = Math.floor(Date.now() / 1000),
}) {
  const encoder = new TextEncoder();
  const head = base64url(encoder.encode(JSON.stringify({ alg, ...header })));
  const body = base64url(
    encoder.encode(
      JSON.stringify(
        ttlSeconds === undefined ? claims : { iat: now, exp: now + ttlSeconds, ...claims },
      ),
    ),
  );
  const input = `${head}.${body}`;
  const signature = await crypto.subtle.sign(
    ALGORITHMS[alg].signAs,
    await signingKey(alg, key),
    encoder.encode(input),
  );
  return `${input}.${base64url(new Uint8Array(signature))}`;
}

/**
 * The JWT a GitHub App signs to ask for an installation token: RS256, `iss` the App id, issued a minute back for clock
 * drift and good for nine minutes (GitHub allows ten).
 * @param {string} appId
 * @param {string | JsonWebKey | CryptoKey} privateKey the App's key, PKCS#1 as downloaded or PKCS#8
 * @param {number} [now] milliseconds
 * @returns {Promise<string>}
 */
export function githubAppJwt(appId, privateKey, now = Date.now()) {
  const iat = Math.floor(now / 1000) - 60;
  return signJwt({ alg: "RS256", key: privateKey, claims: { iss: appId, iat, exp: iat + 600 } });
}
