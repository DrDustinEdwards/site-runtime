/**
 * The issuer Access writes, https://<team domain>, from the team domain as either site keeps it: with or without the
 * scheme, with or without a trailing slash. Null when it is missing or not a <team>.cloudflareaccess.com host.
 * @param {string | undefined} teamDomain
 * @returns {string | null}
 */
export function accessIssuer(teamDomain: string | undefined): string | null;
/**
 * The team's signing keys at https://<team domain>/cdn-cgi/access/certs, cached per isolate. A kid not in the cache
 * refetches, at most once per REFETCH_COOLDOWN_MS. A failed or timed-out fetch (KEYS_TIMEOUT_MS), an error status or a
 * body with no key list THROWS.
 * @param {string} teamDomain
 * @returns {KeySource}
 */
export function accessKeys(teamDomain: string): KeySource;
/**
 * The Access token a request carries: the header, else (with `cookie`) the CF_Authorization cookie, else null. The
 * header is added only on paths an Access application covers; the cookie rides on every path of the host.
 * @param {Request} request
 * @param {{ cookie?: boolean }} [options]
 * @returns {string | null}
 */
export function accessToken(request: Request, { cookie }?: {
    cookie?: boolean;
}): string | null;
/**
 * One Access application's verdict on a token: the claims, or the reason it is refused (`verifyJwt`'s reasons:
 * malformed, algorithm, unknown-key, signature, issuer, audience, expired, not-yet-valid).
 * @param {string} token
 * @param {KeySource} keys
 * @param {{ issuer: string, audience: string, now?: number }} expect `now` in epoch milliseconds
 * @returns {Promise<import("./access-login.mjs").JwtVerdict>}
 */
export function verifyAccessToken(token: string, keys: KeySource, expect: {
    issuer: string;
    audience: string;
    now?: number;
}): Promise<import("./access-login.mjs").JwtVerdict>;
/**
 * One Access application's verdict on a request. `not-configured` when the team domain or the audience is missing,
 * `no-token` when the request carries none, a token reason when it fails; otherwise the token's claims, which the
 * caller reads for `email` (a person) or `common_name` (a service token). Throws when the keys cannot be fetched.
 * @param {Request} request
 * @param {{ teamDomain: string | undefined, audience: string | undefined, cookie?: boolean, keys?: KeySource, now?: number }} options
 * @returns {Promise<AccessVerdict>}
 */
export function verifyAccessRequest(request: Request, { teamDomain, audience, cookie, keys, now }: {
    teamDomain: string | undefined;
    audience: string | undefined;
    cookie?: boolean;
    keys?: KeySource;
    now?: number;
}): Promise<AccessVerdict>;
/**
 * The network's one admin model, from the environment: `ADMIN_EMAIL` is the main admin, the one address that may change
 * who is admin, and `CO_OWNER_EMAILS` (comma-separated) are the co-owners, who have full use and cannot change admins.
 * Addresses are trimmed and lower-cased, blanks dropped. An unset `ADMIN_EMAIL` closes the site to everyone, co-owners
 * included, so losing the main admin's secret never leaves a co-owner as the only way in. Both settings are set only
 * in Cloudflare; nothing inside a site can change who is admin.
 * @param {{ ADMIN_EMAIL?: string, CO_OWNER_EMAILS?: string }} env
 * @returns {{ admin: string | null, coOwners: string[], all: string[] }}
 */
export function adminRoster(env: {
    ADMIN_EMAIL?: string;
    CO_OWNER_EMAILS?: string;
}): {
    admin: string | null;
    coOwners: string[];
    all: string[];
};
/**
 * Every admin, the main admin first: who may use the site. Unset `ADMIN_EMAIL` is an empty list, which admits nobody.
 * @param {{ ADMIN_EMAIL?: string, CO_OWNER_EMAILS?: string }} env
 * @returns {string[]}
 */
export function adminEmails(env: {
    ADMIN_EMAIL?: string;
    CO_OWNER_EMAILS?: string;
}): string[];
/**
 * Whether `email` is the main admin or a co-owner, compared in lower case. Fails closed.
 * @param {{ ADMIN_EMAIL?: string, CO_OWNER_EMAILS?: string }} env
 * @param {unknown} email
 */
export function isAdminEmail(env: {
    ADMIN_EMAIL?: string;
    CO_OWNER_EMAILS?: string;
}, email: unknown): boolean;
/**
 * Whether `email` is the main admin, the only one who may change who is admin. Fails closed.
 * @param {{ ADMIN_EMAIL?: string, CO_OWNER_EMAILS?: string }} env
 * @param {unknown} email
 */
export function isMainAdmin(env: {
    ADMIN_EMAIL?: string;
    CO_OWNER_EMAILS?: string;
}, email: unknown): boolean;
/**
 * The admin Access signed this request for, or null. `admins` (a list, or a comma-separated string; default
 * `adminEmails(env)`) is who may pass; a site that checks the token against its own signed-in user passes that one
 * email. With ACCESS_DEV_BYPASS="1" on a localhost URL the first admin passes with no token.
 * @param {Request} request
 * @param {Partial<AccessSecrets> & { ADMIN_EMAIL?: string, CO_OWNER_EMAILS?: string }} env
 * @param {{ admins?: string | readonly string[], keys?: import("./access-login.mjs").KeySource, now?: number }} [options]
 * @returns {Promise<{ email: string } | null>}
 */
export function accessAdmin(request: Request, env: Partial<AccessSecrets> & {
    ADMIN_EMAIL?: string;
    CO_OWNER_EMAILS?: string;
}, { admins, keys, now }?: {
    admins?: string | readonly string[];
    keys?: import("./access-login.mjs").KeySource;
    now?: number;
}): Promise<{
    email: string;
} | null>;
/**
 * Where an admin without Access's cookie goes: `path` (the one path the Access application covers, which sets the
 * cookie and comes back), with the current page as `next`.
 * @param {Request} request
 * @param {{ path?: string }} [options]
 * @returns {string}
 */
export function accessSignInUrl(request: Request, { path }?: {
    path?: string;
}): string;
/**
 * The page to land on after Access: `next` when it is a path under `prefix` on this site (and not the Access path
 * itself, which would loop), else `prefix`.
 * @param {string | null | undefined} next
 * @param {{ prefix?: string, path?: string }} [options]
 * @returns {string}
 */
export function safeAdminNext(next: string | null | undefined, { prefix, path }?: {
    prefix?: string;
    path?: string;
}): string;
/**
 * The idle check for a request on an admin path, run in the Worker's fetch before the app. The session is the Access
 * token's (`sub` and `iat`), or `session` for a host whose own sign-in is not an Access token on the request (`id` an
 * opaque value only the server can make, `signedInAt` epoch milliseconds). With neither there is nothing to time and it
 * answers `{ idle: false }` (Access or `accessAdmin` refuses the request). The last request is the seen cookie's time
 * when its signature matches this session, else the sign-in time. Past `idleSeconds`: `{ idle: true, response }`, a
 * redirect to Access's logout; otherwise `{ idle: false, cookie }`, the Set-Cookie that records this request, for the
 * site to append to its response. A background request (isBackground) is checked but records nothing, so a page left
 * polling does not keep its admin signed in. A site with two Access apps (each its own token) gives each its own
 * `cookieName` (a `__Host-` name), so moving between them does not read the other's cookie as no request. `secret`
 * (a server-only value, such as a Worker secret, at least 32 characters) keys the cookie's signature (seenMac). It is
 * required: with a session to time and no secret it throws, so a Worker missing its key fails on its admin paths
 * instead of timing its admins with a cookie they could write.
 * @param {Request} request
 * @param {{ idleSeconds?: number, now?: number, session?: { id: string, signedInAt: number } | null, cookieName?: string, secret: string }} options `now` in epoch milliseconds
 * @returns {Promise<{ idle: true, response: Response } | { idle: false, cookie?: string }>}
 */
export function adminIdle(request: Request, { idleSeconds, now, session, cookieName, secret, }: {
    idleSeconds?: number;
    now?: number;
    session?: {
        id: string;
        signedInAt: number;
    } | null;
    cookieName?: string;
    secret: string;
}): Promise<{
    idle: true;
    response: Response;
} | {
    idle: false;
    cookie?: string;
}>;
/**
 * `adminIdle` around a site's handler, for its Worker's fetch: on a path under one of `prefixes` (default `/admin`),
 * an idle admin gets the logout redirect and an active one's response carries the seen cookie; every other path goes
 * straight to `handle`.
 * @param {Request} request
 * @param {() => Promise<Response>} handle
 * @param {{ prefixes?: readonly string[], idleSeconds?: number, session?: { id: string, signedInAt: number } | null, cookieName?: string, secret: string }} options
 * @returns {Promise<Response>}
 */
export function withAdminIdle(request: Request, handle: () => Promise<Response>, { prefixes, idleSeconds, session, cookieName, secret }: {
    prefixes?: readonly string[];
    idleSeconds?: number;
    session?: {
        id: string;
        signedInAt: number;
    } | null;
    cookieName?: string;
    secret: string;
}): Promise<Response>;
/** @import { JwtRefusal } from "./access-login.mjs" */
/**
 * @typedef {"not-configured" | "no-token" | JwtRefusal} AccessRefusal
 */
/**
 * @typedef {| { ok: true; claims: Record<string, unknown> }
 * | { ok: false; reason: AccessRefusal }} AccessVerdict
 */
/**
 * The Access settings a site's Env declares for `accessAdmin`.
 * @typedef {object} AccessSecrets
 * @property {string} ACCESS_TEAM_DOMAIN https://<team>.cloudflareaccess.com
 * @property {string} ACCESS_AUD The Access application's Audience (AUD) tag.
 * @property {string} [ACCESS_DEV_BYPASS] "1" lets a localhost URL in with no token, as the first admin. Development only.
 */
/**
 * @typedef {object} AdminSettings
 * @property {string} [ADMIN_EMAIL]
 * @property {string} [CO_OWNER_EMAILS]
 */
/**
 * A signed-in session that is not an Access token on the request: an opaque id only the server can make, and the sign-in time.
 * @typedef {object} IdleSession
 * @property {string} id
 * @property {number} signedInAt
 */
export const ACCESS_JWT_HEADER: "cf-access-jwt-assertion";
export const ACCESS_COOKIE: "CF_Authorization";
/** How long an unknown kid waits before it may refetch the keys again, so a forged kid cannot hammer the endpoint. */
export const REFETCH_COOLDOWN_MS: 30000;
/** An admin's Access session ends after this long without a request: an hour, in seconds. */
export const ADMIN_IDLE_SECONDS: number;
/** The cookie holding the admin's last request time, signed for their Access session. */
export const ADMIN_SEEN_COOKIE: "__Host-admin-seen";
/** Access's logout: it revokes the session in every application and clears the cookie, so the next visit signs in. */
export const ACCESS_LOGOUT_PATH: "/cdn-cgi/access/logout";
/** The request header a page sets on its polling fetches, so they are timed but do not count as activity. */
export const BACKGROUND_HEADER: "x-background";
export type AccessRefusal = "not-configured" | "no-token" | JwtRefusal;
export type AccessVerdict = {
    ok: true;
    claims: Record<string, unknown>;
} | {
    ok: false;
    reason: AccessRefusal;
};
/**
 * The Access settings a site's Env declares for `accessAdmin`.
 */
export type AccessSecrets = {
    /**
     * https://<team>.cloudflareaccess.com
     */
    ACCESS_TEAM_DOMAIN: string;
    /**
     * The Access application's Audience (AUD) tag.
     */
    ACCESS_AUD: string;
    /**
     * "1" lets a localhost URL in with no token, as the first admin. Development only.
     */
    ACCESS_DEV_BYPASS?: string | undefined;
};
export type AdminSettings = {
    ADMIN_EMAIL?: string | undefined;
    CO_OWNER_EMAILS?: string | undefined;
};
/**
 * A signed-in session that is not an Access token on the request: an opaque id only the server can make, and the sign-in time.
 */
export type IdleSession = {
    id: string;
    signedInAt: number;
};
export type Jwk = import("./access-login.mjs").Jwk;
export type KeySource = import("./access-login.mjs").KeySource;
import type { JwtRefusal } from "./access-login.mjs";
