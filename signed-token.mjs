/**
 * The one stateless signed-token format for links a site emails (an unsubscribe link, a card-update page, an open
 * pixel): `base64url(JSON payload).base64url(HMAC-SHA-256)`. Integrity, not secrecy: anyone holding a token can read
 * its payload, so a payload carries ids and never anything private. Each caller checks its own payload's fields.
 *
 * - Keys are hex strings, newest first. The first present one signs; every one verifies, so a key can be rotated
 *   without breaking links already in inboxes: put the new key first and keep the old one after it until the
 *   longest-lived link has aged out. Empty or missing entries are skipped, so `[env.NEW_KEY, env.OLD_KEY]` works
 *   before the new secret is set.
 * - A link key is its own secret, never a key that also encrypts data at rest: links can be requested by the
 *   thousand, and a key should do one job.
 * - Verification is crypto.subtle.verify, which compares in constant time.
 */

import { base64url, fromBase64url, fromHex } from "./encoding.mjs";

/** @param {readonly (string | null | undefined)[]} keys */
function presentKeys(keys) {
  const hexes = [...new Set(keys.filter((hex) => typeof hex === "string" && hex !== ""))];
  if (hexes.length === 0) throw new Error("no signing key is set");
  return /** @type {string[]} */ (hexes);
}

/** @param {string} hex */
function hmacKey(hex) {
  return crypto.subtle.importKey("raw", fromHex(hex), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/**
 * Sign a JSON payload into a compact `payload.signature` token with the first present key.
 * @param {readonly (string | null | undefined)[]} keys hex keys, newest first
 * @param {object} payload
 * @returns {Promise<string>}
 */
export async function signToken(keys, payload) {
  const key = await hmacKey(presentKeys(keys)[0] ?? "");
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes));
  return `${base64url(bytes)}.${base64url(signature)}`;
}

/**
 * Verify a token against every present key and parse its payload. Null on any tamper, format or parse failure, or
 * when the payload is not a JSON object. Throws only when no key is set, which is a configuration error, not a bad
 * link.
 * @param {readonly (string | null | undefined)[]} keys hex keys, newest first
 * @param {string} token
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function readSignedToken(keys, token) {
  const hexes = presentKeys(keys);
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  try {
    const bytes = fromBase64url(token.slice(0, dot));
    const signature = fromBase64url(token.slice(dot + 1));
    let verified = false;
    for (const hex of hexes) {
      if (await crypto.subtle.verify("HMAC", await hmacKey(hex), signature, bytes)) {
        verified = true;
        break;
      }
    }
    if (!verified) return null;
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
