/**
 * A PEM private key as PKCS#8 bytes. A PKCS#1 RSA key is wrapped with the rsaEncryption algorithm id, so a GitHub App
 * key is pasted as downloaded.
 * @param {string} pem
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function pkcs8FromPem(pem: string): Uint8Array<ArrayBuffer>;
/**
 * A signed compact JWT. `header` adds fields such as `kid` or `typ` after `alg`. With `ttlSeconds`, `iat` and
 * `exp` are filled from `now` (seconds), unless `claims` sets them.
 * @param {{ alg: "RS256" | "ES256", key: string | JsonWebKey | CryptoKey, claims: Record<string, unknown>, header?: Record<string, unknown>, ttlSeconds?: number, now?: number }} options
 * @returns {Promise<string>}
 */
export function signJwt({ alg, key, claims, header, ttlSeconds, now, }: {
    alg: "RS256" | "ES256";
    key: string | JsonWebKey | CryptoKey;
    claims: Record<string, unknown>;
    header?: Record<string, unknown>;
    ttlSeconds?: number;
    now?: number;
}): Promise<string>;
/**
 * The JWT a GitHub App signs to ask for an installation token: RS256, `iss` the App id, issued a minute back for clock
 * drift and good for nine minutes (GitHub allows ten).
 * @param {string} appId
 * @param {string | JsonWebKey | CryptoKey} privateKey the App's key, PKCS#1 as downloaded or PKCS#8
 * @param {number} [now] milliseconds
 * @returns {Promise<string>}
 */
export function githubAppJwt(appId: string, privateKey: string | JsonWebKey | CryptoKey, now?: number): Promise<string>;
