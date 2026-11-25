/**
 * The SaaS app's endpoints, or null while any setting is missing. ACCESS_TEAM_DOMAIN is the team domain as the
 * dashboard shows it, https://<team>.cloudflareaccess.com (the scheme and a trailing slash are optional); null for any
 * other host.
 * @param {{ ACCESS_TEAM_DOMAIN?: string, ACCESS_SAAS_CLIENT_ID?: string, ACCESS_SAAS_CLIENT_SECRET?: string }} env
 */
export function accessSaas(env: {
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_SAAS_CLIENT_ID?: string;
    ACCESS_SAAS_CLIENT_SECRET?: string;
}): {
    clientId: string;
    clientSecret: string;
    issuer: string;
    authorizationUrl: string;
    tokenUrl: string;
    jwksUrl: string;
} | null;
/** A fresh PKCE verifier (43 characters, 256 random bits) and OIDC nonce for one sign-in. Keep both server-side. */
export function newSignIn(): {
    verifier: string;
    nonce: `${string}-${string}-${string}-${string}-${string}`;
};
/**
 * Where the browser goes to sign in with Access.
 * @param {AccessSaas} saas
 * @param {{ redirectUri: string, state: string, verifier: string, nonce: string }} input
 */
export function authorizationUrl(saas: AccessSaas, input: {
    redirectUri: string;
    state: string;
    verifier: string;
    nonce: string;
}): Promise<string>;
/** Drops every cached key set, for a test whose stubs sign with a new key under the same kid. */
export function forgetKeys(): void;
/**
 * The keys at a JWKS URL, cached per isolate for up to KEYS_MAX_AGE_MS; `fresh` refetches.
 * @param {string} jwksUrl @returns {KeySource}
 */
export function remoteKeys(jwksUrl: string): KeySource;
/**
 * The family's one JWT check, with the reason for a refusal: RS256 only (the algorithm is pinned here, never taken
 * from the token, so `alg: none` and HMAC-with-the-public-key fail), signed by one of `keys`, issued by `issuer`
 * exactly, for `audience` (a string or one entry of an array), with an `exp`, and in date with 60 seconds of skew. A
 * kid not in the cached set refetches once. Both this module's ID token and `./access`'s request token use it.
 *
 * Only a fault in the token is a refusal. A key source that throws (`./access` throws when the keys cannot be fetched)
 * is not caught: an outage reads as an outage.
 * @param {string} token
 * @param {KeySource} keys
 * @param {{ issuer: string, audience: string, now?: number }} expect `now` in epoch milliseconds, for a test's clock
 * @returns {Promise<JwtVerdict>}
 */
export function verifyJwt(token: string, keys: KeySource, expect: {
    issuer: string;
    audience: string;
    now?: number;
}): Promise<JwtVerdict>;
/**
 * The payload of an RS256 JWT signed by one of `keys`, issued by `issuer` for `audience` and in date, or null
 * (`verifyJwt` without the reason).
 * @param {string} token
 * @param {KeySource} keys
 * @param {{ issuer: string, audience: string, now?: number }} expect
 * @returns {Promise<Record<string, unknown> | null>}
 */
export function verifyIdToken(token: string, keys: KeySource, expect: {
    issuer: string;
    audience: string;
    now?: number;
}): Promise<Record<string, unknown> | null>;
/**
 * Exchanges Access's code for tokens and verifies the ID token: signed by the SaaS app's keys, issued by it, for this
 * client, carrying this sign-in's nonce, and naming an email that is not marked unverified. Anything else is a
 * refusal with a reason a log can carry; no token or secret is in it.
 * The exchange is bounded, so a hung token endpoint does not hold the sign-in.
 * @param {AccessSaas} saas
 * @param {{ code: string, redirectUri: string, verifier: string, nonce: string, now?: number }} input `now` in epoch ms, for a test's clock
 * @param {KeySource} [keys]
 * @returns {Promise<SignedIn>}
 */
export function finishSignIn(saas: AccessSaas, input: {
    code: string;
    redirectUri: string;
    verifier: string;
    nonce: string;
    now?: number;
}, keys?: KeySource): Promise<SignedIn>;
/** @typedef {JsonWebKey & { kid?: string }} Jwk */
/** @typedef {(kid: string, fresh: boolean) => Promise<Jwk | undefined>} KeySource */
/**
 * How long a fetched key set is trusted without a refetch: an hour, for this module's keys and ./access's. Access
 * rotates its signing keys and drops the old one after a window; without a limit an isolate that stays warm would keep
 * accepting a key Access has retired (ASVS 9.1.1 and 9.1.3: tokens are checked against the issuer's current keys).
 */
export const KEYS_MAX_AGE_MS: number;
/**
 * The upstream sign-in with Cloudflare Access for SaaS (OIDC), the one login every MCP server in the family uses.
 * The state of a sign-in in flight is kept by the caller, with
 */
export type AccessEnv = {
    /**
     * https://<team>.cloudflareaccess.com
     */
    ACCESS_TEAM_DOMAIN?: string | undefined;
    ACCESS_SAAS_CLIENT_ID?: string | undefined;
    ACCESS_SAAS_CLIENT_SECRET?: string | undefined;
};
export type AccessSaas = {
    clientId: string;
    clientSecret: string;
    /**
     * https://<team>.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<client id>
     */
    issuer: string;
    authorizationUrl: string;
    tokenUrl: string;
    jwksUrl: string;
};
/**
 * Why a JWT was refused. Only a fault in the token is a refusal; a key source that throws is not caught.
 */
export type JwtRefusal = "malformed" | "algorithm" | "unknown-key" | "signature" | "issuer" | "audience" | "expired" | "not-yet-valid";
export type JwtVerdict = {
    ok: true;
    claims: Record<string, unknown>;
} | {
    ok: false;
    reason: JwtRefusal;
};
export type SignedIn = {
    ok: true;
    email: string;
    name?: string;
} | {
    ok: false;
    reason: string;
};
export type Jwk = JsonWebKey & {
    kid?: string;
};
export type KeySource = (kid: string, fresh: boolean) => Promise<Jwk | undefined>;
