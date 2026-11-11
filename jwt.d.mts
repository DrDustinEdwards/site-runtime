/** One JWT signer on WebCrypto (jwt.mjs): RS256 and ES256, a PEM (PKCS#8 or PKCS#1), a JWK or a CryptoKey. */

/** A PEM private key as PKCS#8 bytes; a PKCS#1 RSA key (GitHub's) is wrapped. Literal "\n" sequences read as newlines. */
export function pkcs8FromPem(pem: string): Uint8Array<ArrayBuffer>;
/** A signed compact JWT; `ttlSeconds` fills `iat` and `exp` from `now` (seconds) unless `claims` sets them. */
export function signJwt(options: {
  alg: "RS256" | "ES256";
  key: string | JsonWebKey | CryptoKey;
  claims: Record<string, unknown>;
  header?: Record<string, unknown>;
  ttlSeconds?: number;
  now?: number;
}): Promise<string>;
/** A GitHub App's JWT: RS256, `iss` the App id, issued a minute back, nine minutes long. */
export function githubAppJwt(
  appId: string,
  privateKey: string | JsonWebKey | CryptoKey,
  now?: number,
): Promise<string>;
