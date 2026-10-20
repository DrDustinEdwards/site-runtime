/**
 * The upstream sign-in with Cloudflare Access for SaaS (OIDC), the one login every MCP server in the family uses
 * (access-login.mjs says where each part came from). The state of a sign-in in flight is kept by the caller, with
 * @cloudflare/workers-oauth-provider's beginUpstream and finishUpstream.
 */
export type AccessEnv = {
    /** https://<team>.cloudflareaccess.com */
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_SAAS_CLIENT_ID?: string;
    ACCESS_SAAS_CLIENT_SECRET?: string;
};
export type AccessSaas = {
    clientId: string;
    clientSecret: string;
    /** https://<team>.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<client id> */
    issuer: string;
    authorizationUrl: string;
    tokenUrl: string;
    jwksUrl: string;
};
/** The SaaS app's endpoints, or null while any setting is missing. */
export function accessSaas(env: AccessEnv): AccessSaas | null;
/** A fresh PKCE verifier and OIDC nonce for one sign-in. Keep both server-side. */
export function newSignIn(): { verifier: string; nonce: string };
/** Where the browser goes to sign in with Access. */
export function authorizationUrl(saas: AccessSaas, input: { redirectUri: string; state: string; verifier: string; nonce: string }): Promise<string>;

export type Jwk = JsonWebKey & { kid?: string };
/** Finds the public key for a kid; `fresh` asks for a refetch past any cache. */
export type KeySource = (kid: string, fresh: boolean) => Promise<Jwk | undefined>;
/** The keys at a JWKS URL, cached per isolate. */
export function remoteKeys(jwksUrl: string): KeySource;
/** The payload of an RS256 JWT signed by one of `keys`, for `issuer` and `audience`, in date; else null. */
export function verifyIdToken(token: string, keys: KeySource, expect: { issuer: string; audience: string; now?: number }): Promise<Record<string, unknown> | null>;

export type SignedIn = { ok: true; email: string; name?: string } | { ok: false; reason: string };
/** Exchanges Access's code for tokens and verifies the ID token. */
export function finishSignIn(saas: AccessSaas, input: { code: string; redirectUri: string; verifier: string; nonce: string }, keys?: KeySource): Promise<SignedIn>;
