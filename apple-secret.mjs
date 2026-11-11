/**
 * The client secret Sign in with Apple wants: not a stored string but a short JWT the site signs with its Apple key
 * (developer.apple.com, "Creating a client secret"). Apple refuses one that lives longer than six months, so a secret
 * pasted once would stop sign-in on the day it expired. It is made here, from the key, when a site builds its auth.
 *
 * - ES256 with WebCrypto: the .p8 file Apple gives is a PKCS#8 P-256 key, and WebCrypto's ECDSA signature is already
 *   the raw r||s form a JWS needs. Signed by ./jwt's signJwt, the one signer.
 * - 30 days of life. A Worker isolate lasts hours, so every isolate builds a fresh one long before it runs out.
 * - Any of the four settings missing: null, and the site offers no Apple button.
 */

import { signJwt } from "./jwt.mjs";

const APPLE_AUDIENCE = "https://appleid.apple.com";
const LIFETIME_SECONDS = 30 * 24 * 60 * 60;

/**
 * @param {{ APPLE_CLIENT_ID?: string, APPLE_TEAM_ID?: string, APPLE_KEY_ID?: string, APPLE_PRIVATE_KEY?: string }} env
 *   APPLE_CLIENT_ID is the Services ID, APPLE_PRIVATE_KEY the .p8 file's text.
 * @param {number} [now] seconds since the epoch
 * @returns {Promise<string | null>}
 */
export async function appleClientSecret(env, now = Math.floor(Date.now() / 1000)) {
  const {
    APPLE_CLIENT_ID: clientId,
    APPLE_TEAM_ID: teamId,
    APPLE_KEY_ID: keyId,
    APPLE_PRIVATE_KEY: pem,
  } = env;
  if (!clientId || !teamId || !keyId || !pem) return null;
  return signJwt({
    alg: "ES256",
    key: pem,
    header: { kid: keyId },
    claims: {
      iss: teamId,
      iat: now,
      exp: now + LIFETIME_SECONDS,
      aud: APPLE_AUDIENCE,
      sub: clientId,
    },
  });
}
