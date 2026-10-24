/**
 * The client secret Sign in with Apple wants: not a stored string but a short JWT the site signs with its Apple key
 * (developer.apple.com, "Creating a client secret"). Apple refuses one that lives longer than six months, so a secret
 * pasted once would stop sign-in on the day it expired. It is made here, from the key, when a site builds its auth.
 *
 * - ES256 with WebCrypto: the .p8 file Apple gives is a PKCS#8 P-256 key, and WebCrypto's ECDSA signature is already
 *   the raw r||s form a JWS needs. No JWT library.
 * - 30 days of life. A Worker isolate lasts hours, so every isolate builds a fresh one long before it runs out.
 * - Any of the four settings missing: null, and the site offers no Apple button.
 */

const APPLE_AUDIENCE = "https://appleid.apple.com";
const LIFETIME_SECONDS = 30 * 24 * 60 * 60;

/** @param {string} text */
const base64url = (text) => btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
/** @param {ArrayBuffer} bytes */
const bytesToBase64url = (bytes) => base64url(String.fromCharCode(...new Uint8Array(bytes)));

/** @param {string} pem */
function pkcs8(pem) {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\\n|\s/g, "");
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

/**
 * @param {{ APPLE_CLIENT_ID?: string, APPLE_TEAM_ID?: string, APPLE_KEY_ID?: string, APPLE_PRIVATE_KEY?: string }} env
 *   APPLE_CLIENT_ID is the Services ID, APPLE_PRIVATE_KEY the .p8 file's text.
 * @param {number} [now] seconds since the epoch
 * @returns {Promise<string | null>}
 */
export async function appleClientSecret(env, now = Math.floor(Date.now() / 1000)) {
  const { APPLE_CLIENT_ID: clientId, APPLE_TEAM_ID: teamId, APPLE_KEY_ID: keyId, APPLE_PRIVATE_KEY: pem } = env;
  if (!clientId || !teamId || !keyId || !pem) return null;
  const key = await crypto.subtle.importKey("pkcs8", pkcs8(pem), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const claims = base64url(
    JSON.stringify({ iss: teamId, iat: now, exp: now + LIFETIME_SECONDS, aud: APPLE_AUDIENCE, sub: clientId }),
  );
  const input = `${header}.${claims}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(input));
  return `${input}.${bytesToBase64url(signature)}`;
}
