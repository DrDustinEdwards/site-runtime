/** Byte encodings (encoding.mjs). A string input is encoded as UTF-8 first. */
type Input = Uint8Array | ArrayBuffer | string;
/** The parts' bytes one after another, in one new array. */
export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer>;
/** Lowercase hex, two digits a byte. */
export function toHex(input: Input): string;
/** The bytes of a hex string; throws on an odd length or a non-hex character. */
export function fromHex(hex: string): Uint8Array<ArrayBuffer>;
/** Standard base64, padded. */
export function toBase64(input: Input): string;
/** The bytes of standard base64, whitespace ignored. */
export function fromBase64(text: string): Uint8Array<ArrayBuffer>;
/** URL-safe base64, no padding. */
export function base64url(input: Input): string;
/** The bytes of URL-safe base64, padded or not. */
export function fromBase64url(text: string): Uint8Array<ArrayBuffer>;
/** Standard base64 decoded to UTF-8 text. */
export function fromBase64Text(text: string): string;
/** URL-safe base64 decoded to UTF-8 text. */
export function fromBase64urlText(text: string): string;
/** An opaque page cursor: base64url JSON of the list it came from (`scope`) and a position (a page or an offset). */
export function pageCursor(scope: string, position: number): string;
/** The position a `pageCursor` for `scope` carries; null for another scope, a negative or fractional position, or junk. */
export function readPageCursor(scope: string, cursor: string): number | null;
/** SHA-256 as bytes. */
export function sha256(input: Input): Promise<Uint8Array<ArrayBuffer>>;
/** SHA-256 as lowercase hex. */
export function sha256Hex(input: Input): Promise<string>;
/** HMAC-SHA-256 of `payload` under the UTF-8 bytes of `secret`, as bytes. */
export function hmacSha256(
  secret: string,
  payload: Uint8Array | ArrayBuffer | string,
): Promise<Uint8Array<ArrayBuffer>>;
/** HMAC-SHA-256 of `payload` under the UTF-8 bytes of `secret`, as lowercase hex. */
export function hmacSha256Hex(
  secret: string,
  payload: Uint8Array | ArrayBuffer | string,
): Promise<string>;
/** The standard CRC-32 (IEEE, as PNG and ZIP use) of `bytes`, unsigned. */
export function crc32(bytes: Uint8Array): number;
/** JSON with every object's keys sorted and `undefined` members dropped, so equal values print alike. */
export function canonicalJson(value: unknown): string;
/** FNV-1a, 32 bits, over UTF-16 code units, as eight hex digits: a fingerprint, never a security boundary. */
export function fnv1a32(input: string): string;
