/** Byte encodings (encoding.mjs). A string input is encoded as UTF-8 first. */
type Input = Uint8Array | ArrayBuffer | string;
/** Lowercase hex, two digits a byte. */
export function toHex(input: Input): string;
/** The bytes of a hex string; throws on an odd length or a non-hex character. */
export function fromHex(hex: string): Uint8Array;
/** Standard base64, padded. */
export function toBase64(input: Input): string;
/** The bytes of standard base64, whitespace ignored. */
export function fromBase64(text: string): Uint8Array;
/** URL-safe base64, no padding. */
export function base64url(input: Input): string;
/** The bytes of URL-safe base64, padded or not. */
export function fromBase64url(text: string): Uint8Array;
/** SHA-256 as lowercase hex. */
export function sha256Hex(input: Input): Promise<string>;
