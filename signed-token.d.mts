/** The one signed-token format for emailed links (signed-token.mjs). Keys are hex, newest first: the first present one signs, every one verifies. */
/** Sign a JSON payload into a compact `payload.signature` token with the first present key. */
export function signToken(keys: readonly (string | null | undefined)[], payload: object): Promise<string>;
/** Verify a token against every present key and parse its payload; null on any tamper, format or parse failure. Throws when no key is set. */
export function readSignedToken(keys: readonly (string | null | undefined)[], token: string): Promise<Record<string, unknown> | null>;
