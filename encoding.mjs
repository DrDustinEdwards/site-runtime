/**
 * Byte encodings, once, for every repo: hex, base64, base64url and a SHA-256 hex digest. Each site had its own copy, a
 * few on `jose` or Buffer (which a Worker has only with nodejs_compat). Web APIs only.
 *
 * Every encoder takes bytes (a Uint8Array or ArrayBuffer) or a string, which is encoded as UTF-8 first.
 */

/** @param {Uint8Array | ArrayBuffer | string} input */
function bytesOf(input) {
  return typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
}

/**
 * Lowercase hex, two digits a byte.
 * @param {Uint8Array | ArrayBuffer | string} input
 * @returns {string}
 */
export function toHex(input) {
  return Array.from(bytesOf(input), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The bytes of a hex string, either case. Throws on an odd length or a character that is not hex.
 * @param {string} hex
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function fromHex(hex) {
  if (hex.length % 2 || /[^0-9a-f]/i.test(hex)) throw new TypeError("not a hex string");
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

/**
 * Standard base64, padded (GitHub's contents API, data: URLs).
 * @param {Uint8Array | ArrayBuffer | string} input
 * @returns {string}
 */
export function toBase64(input) {
  let binary = "";
  for (const byte of bytesOf(input)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * The bytes of standard base64. Whitespace is dropped first, since GitHub wraps its base64 in lines and `atob` throws
 * on it; anything else that is not base64 throws.
 * @param {string} text
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function fromBase64(text) {
  return Uint8Array.from(atob(text.replace(/\s+/g, "")), (c) => c.charCodeAt(0));
}

/**
 * URL-safe base64 with no padding (RFC 4648 section 5): tokens, JWT parts, VAPID keys.
 * @param {Uint8Array | ArrayBuffer | string} input
 * @returns {string}
 */
export function base64url(input) {
  return toBase64(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The bytes of URL-safe base64, padded or not.
 * @param {string} text
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function fromBase64url(text) {
  const plain = text.replace(/-/g, "+").replace(/_/g, "/");
  return fromBase64(plain + "=".repeat((4 - (plain.length % 4)) % 4));
}

/**
 * The SHA-256 digest of `input`, as lowercase hex.
 * @param {Uint8Array | ArrayBuffer | string} input
 * @returns {Promise<string>}
 */
export async function sha256Hex(input) {
  return toHex(await crypto.subtle.digest("SHA-256", bytesOf(input)));
}

/**
 * HMAC-SHA-256 of `payload` under the UTF-8 bytes of `secret`, as lowercase hex.
 * @param {string} secret
 * @param {Uint8Array | ArrayBuffer | string} payload
 * @returns {Promise<string>}
 */
export async function hmacSha256Hex(secret, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, bytesOf(payload)));
}

/**
 * FNV-1a, 32 bits, over UTF-16 code units: a short stable fingerprint (a cache-busting version, an id from a string),
 * never a security boundary.
 * @param {string} input
 * @returns {string} eight lowercase hex digits
 */
export function fnv1a32(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
