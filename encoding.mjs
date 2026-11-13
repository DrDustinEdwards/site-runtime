/**
 * Byte encodings, once, for every repo: hex, base64, base64url and a SHA-256 hex digest. Each site had its own copy, a
 * few on `jose` or Buffer (which a Worker has only with nodejs_compat). Web APIs only.
 *
 * Every encoder takes bytes (a Uint8Array or ArrayBuffer) or a string, which is encoded as UTF-8 first.
 */

/**
 * The parts' bytes one after another, in one new array.
 * @param {readonly Uint8Array[]} parts
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function concatBytes(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

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
 * Standard base64 read back as UTF-8 text (a GitHub file's content, a cookie's payload).
 * @param {string} text
 * @returns {string}
 */
export function fromBase64Text(text) {
  return new TextDecoder().decode(fromBase64(text));
}

/**
 * URL-safe base64 read back as UTF-8 text (a JWT's header or claims).
 * @param {string} text
 * @returns {string}
 */
export function fromBase64urlText(text) {
  return new TextDecoder().decode(fromBase64url(text));
}

/**
 * An opaque page cursor: base64url JSON naming the list it came from (`scope`, a tool or route name) and a position (a
 * page or an offset), so a client never builds one and a cursor from one list handed to another is refused.
 * @param {string} scope
 * @param {number} position
 * @returns {string}
 */
export function pageCursor(scope, position) {
  return base64url(JSON.stringify({ t: scope, p: position }));
}

/**
 * The position a `pageCursor` for `scope` carries, or null when it is not one: another scope, not a whole number of zero
 * or more, or not a cursor at all. Unpadded standard base64 reads too.
 * @param {string} scope
 * @param {string} cursor
 * @returns {number | null}
 */
export function readPageCursor(scope, cursor) {
  try {
    const { t, p } = JSON.parse(fromBase64urlText(cursor)) ?? {};
    return t === scope && Number.isInteger(p) && p >= 0 ? p : null;
  } catch {
    return null;
  }
}

/**
 * SHA-256 as bytes.
 * @param {Uint8Array | ArrayBuffer | string} input
 * @returns {Promise<Uint8Array<ArrayBuffer>>}
 */
export async function sha256(input) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytesOf(input)));
}

/**
 * The SHA-256 digest of `input`, as lowercase hex.
 * @param {Uint8Array | ArrayBuffer | string} input
 * @returns {Promise<string>}
 */
export async function sha256Hex(input) {
  return toHex(await sha256(input));
}

/**
 * HMAC-SHA-256 of `payload` under the UTF-8 bytes of `secret`, as bytes.
 * @param {string} secret
 * @param {Uint8Array | ArrayBuffer | string} payload
 * @returns {Promise<Uint8Array<ArrayBuffer>>}
 */
export async function hmacSha256(secret, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, bytesOf(payload)));
}

/**
 * HMAC-SHA-256 of `payload` under the UTF-8 bytes of `secret`, as lowercase hex.
 * @param {string} secret
 * @param {Uint8Array | ArrayBuffer | string} payload
 * @returns {Promise<string>}
 */
export async function hmacSha256Hex(secret, payload) {
  return toHex(await hmacSha256(secret, payload));
}

/** @type {Uint32Array} */
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/**
 * The standard CRC-32 (IEEE 802.3, the one PNG and ZIP use) of `bytes`, unsigned.
 * @param {Uint8Array} bytes
 * @returns {number}
 */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * JSON with every object's keys sorted and `undefined` members dropped, so equal values print alike: the input to a
 * hash of a value (`toolListHash`).
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(/** @type {Record<string, unknown>} */ (value))
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
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
