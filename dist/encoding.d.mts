/**
 * Byte encodings, once, for every repo: hex, base64, base64url and a SHA-256 hex digest. Each site had its own copy, a
 * few on `jose` or Buffer (which a Worker has only with nodejs_compat). Web APIs only.
 *
 * Every encoder takes bytes (a Uint8Array or ArrayBuffer) or a string, which is encoded as UTF-8 first.
 */
/**
 * Byte encodings (encoding.mjs). A string input is encoded as UTF-8 first.
 * @typedef {Uint8Array | ArrayBuffer | string} Input
 */
/**
 * The parts' bytes one after another, in one new array.
 * @param {readonly Uint8Array[]} parts
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer>;
/**
 * Lowercase hex, two digits a byte.
 * @param {Uint8Array | ArrayBuffer | string} input
 * @returns {string}
 */
export function toHex(input: Uint8Array | ArrayBuffer | string): string;
/**
 * The bytes of a hex string, either case. Throws on an odd length or a character that is not hex.
 * @param {string} hex
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function fromHex(hex: string): Uint8Array<ArrayBuffer>;
/**
 * Standard base64, padded (GitHub's contents API, data: URLs).
 * @param {Uint8Array | ArrayBuffer | string} input
 * @returns {string}
 */
export function toBase64(input: Uint8Array | ArrayBuffer | string): string;
/**
 * The bytes of standard base64. Whitespace is dropped first, since GitHub wraps its base64 in lines and `atob` throws
 * on it; anything else that is not base64 throws.
 * @param {string} text
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function fromBase64(text: string): Uint8Array<ArrayBuffer>;
/**
 * URL-safe base64 with no padding (RFC 4648 section 5): tokens, JWT parts, VAPID keys.
 * @param {Uint8Array | ArrayBuffer | string} input
 * @returns {string}
 */
export function base64url(input: Uint8Array | ArrayBuffer | string): string;
/**
 * The bytes of URL-safe base64, padded or not.
 * @param {string} text
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function fromBase64url(text: string): Uint8Array<ArrayBuffer>;
/**
 * Standard base64 read back as UTF-8 text (a GitHub file's content, a cookie's payload).
 * @param {string} text
 * @returns {string}
 */
export function fromBase64Text(text: string): string;
/**
 * URL-safe base64 read back as UTF-8 text (a JWT's header or claims).
 * @param {string} text
 * @returns {string}
 */
export function fromBase64urlText(text: string): string;
/**
 * An opaque page cursor: base64url JSON naming the list it came from (`scope`, a tool or route name) and a position (a
 * page or an offset), so a client never builds one and a cursor from one list handed to another is refused.
 * @param {string} scope
 * @param {number} position
 * @returns {string}
 */
export function pageCursor(scope: string, position: number): string;
/**
 * The position a `pageCursor` for `scope` carries, or null when it is not one: another scope, not a whole number of zero
 * or more, or not a cursor at all. Unpadded standard base64 reads too.
 * @param {string} scope
 * @param {string} cursor
 * @returns {number | null}
 */
export function readPageCursor(scope: string, cursor: string): number | null;
/**
 * SHA-256 as bytes.
 * @param {Uint8Array | ArrayBuffer | string} input
 * @returns {Promise<Uint8Array<ArrayBuffer>>}
 */
export function sha256(input: Uint8Array | ArrayBuffer | string): Promise<Uint8Array<ArrayBuffer>>;
/**
 * The SHA-256 digest of `input`, as lowercase hex.
 * @param {Uint8Array | ArrayBuffer | string} input
 * @returns {Promise<string>}
 */
export function sha256Hex(input: Uint8Array | ArrayBuffer | string): Promise<string>;
/**
 * HMAC-SHA-256 of `payload` under the UTF-8 bytes of `secret`, as bytes.
 * @param {string} secret
 * @param {Uint8Array | ArrayBuffer | string} payload
 * @returns {Promise<Uint8Array<ArrayBuffer>>}
 */
export function hmacSha256(secret: string, payload: Uint8Array | ArrayBuffer | string): Promise<Uint8Array<ArrayBuffer>>;
/**
 * HMAC-SHA-256 of `payload` under the UTF-8 bytes of `secret`, as lowercase hex.
 * @param {string} secret
 * @param {Uint8Array | ArrayBuffer | string} payload
 * @returns {Promise<string>}
 */
export function hmacSha256Hex(secret: string, payload: Uint8Array | ArrayBuffer | string): Promise<string>;
/**
 * The standard CRC-32 (IEEE 802.3, the one PNG and ZIP use) of `bytes`, unsigned.
 * @param {Uint8Array} bytes
 * @returns {number}
 */
export function crc32(bytes: Uint8Array): number;
/**
 * JSON with every object's keys sorted and `undefined` members dropped, so equal values print alike: the input to a
 * hash of a value (`toolListHash`).
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value: unknown): string;
/**
 * FNV-1a, 32 bits, over UTF-16 code units: a short stable fingerprint (a cache-busting version, an id from a string),
 * never a security boundary.
 * @param {string} input
 * @returns {string} eight lowercase hex digits
 */
export function fnv1a32(input: string): string;
/**
 * Byte encodings (encoding.mjs). A string input is encoded as UTF-8 first.
 */
export type Input = Uint8Array | ArrayBuffer | string;
