/**
 * Sign a JSON payload into a compact `payload.signature` token with the first present key.
 * @param {readonly (string | null | undefined)[]} keys hex keys, newest first
 * @param {object} payload
 * @returns {Promise<string>}
 */
export function signToken(keys: readonly (string | null | undefined)[], payload: object): Promise<string>;
/**
 * Verify a token against every present key and parse its payload. Null on any tamper, format or parse failure, or
 * when the payload is not a JSON object. Throws only when no key is set, which is a configuration error, not a bad
 * link.
 * @param {readonly (string | null | undefined)[]} keys hex keys, newest first
 * @param {string} token
 * @returns {Promise<Record<string, unknown> | null>}
 */
export function readSignedToken(keys: readonly (string | null | undefined)[], token: string): Promise<Record<string, unknown> | null>;
