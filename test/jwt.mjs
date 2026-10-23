// A key pair made here and RS256 signing, for the tests of the Access checks and the sign-ins.

/** @param {Uint8Array} bytes */
export const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
/** @param {unknown} value */
export const encode = (value) => b64url(new TextEncoder().encode(JSON.stringify(value)));

const keyParams = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
export const pair = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey(keyParams, true, ["sign", "verify"]));
export const other = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey(keyParams, true, ["sign", "verify"]));
export const publicJwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1" };
/** @type {import("../access-login.d.mts").KeySource} */
export const keys = async (kid) => (kid === "k1" ? publicJwk : undefined);

/** @param {unknown} payload @param {CryptoKey} [key] @param {Record<string, unknown>} [header] */
export async function sign(payload, key = pair.privateKey, header = { alg: "RS256", kid: "k1" }) {
  const input = `${encode(header)}.${encode(payload)}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}
