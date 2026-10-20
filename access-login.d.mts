/**
 * The sign-in round trip with Cloudflare Access for SaaS (OIDC) as the upstream identity (access-login.mjs says
 * which copy each part comes from). The state is held server-side and used once, bound to the browser by a random
 * cookie; PKCE and a nonce on every sign-in; the ID token verified with WebCrypto; who is admitted is the caller's.
 */
/** How long a started sign-in stays usable: the stored state and the binding cookie. */
export const STATE_TTL_SECONDS: 600;
/** The refusal while any setting is missing. */
export const NOT_CONFIGURED: string;

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

export type Jwk = JsonWebKey & { kid?: string };
/** Finds the public key for a kid; `fresh` asks for a refetch past any cache. */
export type KeySource = (kid: string, fresh: boolean) => Promise<Jwk | undefined>;
/** The keys at a JWKS URL, cached per isolate. */
export function remoteKeys(jwksUrl: string): KeySource;
/** The payload of an RS256 JWT signed by one of `keys`, for `issuer` and `audience`, in date; else null. */
export function verifyIdToken(token: string, keys: KeySource, expect: { issuer: string; audience: string; now?: number }): Promise<Record<string, unknown> | null>;

/** Where the started sign-in is kept. A KV namespace is one. */
export type SignInStore = {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options: { expirationTtl: number }): Promise<unknown>;
    delete(key: string): Promise<unknown>;
};
/** What differs between one sign-in and another on the same Worker. */
export type LoginFlow = {
    /** The path Access redirects back to, on this Worker's origin. */
    callbackPath: string;
    /** The binding cookie's name. */
    stateCookie: string;
    /** The binding cookie's Path attribute. */
    cookiePath: string;
    /** Prefix of the stored state's key. */
    kvPrefix: string;
    /** Appended to each refusal, telling the person where to start again. */
    restartHint: string;
    /** The refusal when `isAllowed` says no. */
    deniedMessage: string;
};
export type StartOptions = {
    saas: AccessSaas | null;
    store: SignInStore;
    flow: LoginFlow;
    /** The caller's own value, returned by completeAccessLogin. It never reaches the browser. */
    stored: string;
    extraCookies?: string[];
};
export type CompleteOptions<T> = {
    saas: AccessSaas | null;
    store: SignInStore;
    flow: LoginFlow;
    /** Whether this verified email may sign in. */
    isAllowed: (email: string) => boolean | Promise<boolean>;
    /** Turns the stored value back into what was stored; a throw refuses the callback. Default: the string itself. */
    parse?: (stored: string) => T;
    /** The signing keys; default: the SaaS app's JWKS. */
    keys?: KeySource;
    now?: Date;
};
export type AccessLoginResult<T> = { ok: true; email: string; name?: string; state: T } | { ok: false; response: Response };
/** Stores `stored` against a fresh state token and redirects to Access. */
export function startAccessLogin(request: Request, options: StartOptions): Promise<Response>;
/** Checks the callback, exchanges the code, verifies the ID token and asks `isAllowed`. */
export function completeAccessLogin<T = string>(request: Request, options: CompleteOptions<T>): Promise<AccessLoginResult<T>>;
/** The Set-Cookie value that clears a flow's binding cookie. */
export function clearStateCookie(flow: LoginFlow): string;
