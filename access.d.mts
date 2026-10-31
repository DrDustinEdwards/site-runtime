/** The Cloudflare Access request-token check (access.mjs). */
import type { JwtRefusal, JwtVerdict, KeySource } from "./access-login.d.mts";

export const ACCESS_JWT_HEADER: "cf-access-jwt-assertion";
export const ACCESS_COOKIE: "CF_Authorization";
/** How long an unknown kid waits before it may refetch the keys again. */
export const REFETCH_COOLDOWN_MS: number;

/** https://<team domain>, from the team domain with or without scheme and trailing slash; null when missing or not a host. */
export function accessIssuer(teamDomain: string | undefined): string | null;
/** The team's signing keys, cached per isolate. A fetch that fails, answers an error or carries no key list throws. */
export function accessKeys(teamDomain: string): KeySource;
/** The header token, else (with `cookie`) the CF_Authorization cookie, else null. */
export function accessToken(request: Request, options?: { cookie?: boolean }): string | null;
/** The claims of a token for this application, or why it is refused. `now` in epoch milliseconds. */
export function verifyAccessToken(token: string, keys: KeySource, expect: { issuer: string; audience: string; now?: number }): Promise<JwtVerdict>;

export type AccessRefusal = "not-configured" | "no-token" | JwtRefusal;
export type AccessVerdict = { ok: true; claims: Record<string, unknown> } | { ok: false; reason: AccessRefusal };
/** One Access application's verdict on a request. Throws when the keys cannot be fetched. */
export function verifyAccessRequest(
  request: Request,
  options: { teamDomain: string | undefined; audience: string | undefined; cookie?: boolean; keys?: KeySource; now?: number },
): Promise<AccessVerdict>;

/** The Access settings a site's Env declares for `accessAdmin`. */
export type AccessSecrets = {
  /** https://<team>.cloudflareaccess.com */
  ACCESS_TEAM_DOMAIN: string;
  /** The Access application's Audience (AUD) tag. */
  ACCESS_AUD: string;
  /** "1" lets a localhost URL in with no token, as the first admin. Development only. */
  ACCESS_DEV_BYPASS?: string;
};

/** ADMIN_EMAILS, else ADMIN_EMAIL, split on commas, trimmed and lower-cased; unset is []. */
export function adminEmails(env: { ADMIN_EMAILS?: string; ADMIN_EMAIL?: string }): string[];

/**
 * The admin Access signed this request for (header or CF_Authorization cookie, email compared in lower case), or null.
 * Never throws. `admins` defaults to `adminEmails(env)`; ACCESS_DEV_BYPASS="1" on localhost passes the first admin.
 */
export function accessAdmin(
  request: Request,
  env: Partial<AccessSecrets> & { ADMIN_EMAILS?: string; ADMIN_EMAIL?: string },
  options?: { admins?: string | readonly string[]; keys?: KeySource; now?: number },
): Promise<{ email: string } | null>;

/** `${path}?next=<this page>`; `path` defaults to "/admin/access". */
export function accessSignInUrl(request: Request, options?: { path?: string }): string;

/** `next` when it is under `prefix` (default "/admin") and not the Access `path` (default "/admin/access"), else `prefix`. */
export function safeAdminNext(next: string | null | undefined, options?: { prefix?: string; path?: string }): string;

/** An admin's Access session ends after this long without a request: 3600 seconds. */
export const ADMIN_IDLE_SECONDS: number;
/** The cookie holding the admin's last request time, signed with their Access token. */
export const ADMIN_SEEN_COOKIE: "__Host-admin-seen";
/** Access's logout path, which revokes the session everywhere and clears the cookie. */
export const ACCESS_LOGOUT_PATH: "/cdn-cgi/access/logout";
/**
 * The idle check for a request on an admin path: a redirect to Access's logout after `idleSeconds` (default an hour)
 * without a request, else the Set-Cookie that records this one (none when the request carries no Access token).
 */
export function adminIdle(
  request: Request,
  options?: { idleSeconds?: number; now?: number },
): Promise<{ idle: true; response: Response } | { idle: false; cookie?: string }>;
/**
 * `adminIdle` around a site's handler: on a path under `prefixes` (default `/admin`; `/` for a site that is all admin),
 * the logout redirect for an idle admin, else the handler's response with the seen cookie.
 */
export function withAdminIdle(
  request: Request,
  handle: () => Promise<Response>,
  options?: { prefixes?: readonly string[]; idleSeconds?: number },
): Promise<Response>;
