/**
 * The check that a request came through Cloudflare Access: the token Access signs for each request it lets through,
 * read from the `Cf-Access-Jwt-Assertion` header (or, on request, the `CF_Authorization` cookie) and verified against
 * the team's published keys, with the WebCrypto verifier `./access-login` uses, so there is no JWT library.
 *
 * Presence of the header proves nothing, since anyone can send one. What proves a request passed Access is a signature
 * by a key Access publishes, an `aud` naming THIS application's tag, and an `iss` equal to the team domain,
 * https://<team>.cloudflareaccess.com with no trailing slash. RS256 is pinned. 60 seconds of clock skew either way.
 *
 * Only a fault in the token is a refusal. When the keys cannot be fetched, `accessKeys` throws, so an outage reads as
 * an outage and not as every administrator being locked out silently.
 *
 * `accessAdmin` is the admin check four sites had copied (txasm, Foxing, Foxhound, Germomics): a verified token whose
 * email, folded to lower case, is on the site's list, with the local development bypass (ACCESS_DEV_BYPASS="1", and
 * only on a localhost URL, so a stray copy in production does nothing). It never throws: a refused token, an email off
 * the list and keys that cannot be fetched are all null, the last one logged. What a refusal shows stays the site's.
 *
 * `adminIdle` ends an admin's Access session after ADMIN_IDLE_SECONDS (an hour) without a request: NIST SP 800-63B-4's
 * inactivity timeout at AAL2 ("SHOULD be no more than 1 hour"). Access has session lengths but no idle timeout
 * (developers.cloudflare.com/cloudflare-one/identity/users/session-management, read 2026-10-31); its own 24 hours is
 * the overall limit.
 */

import { verifyJwt } from "./access-login.mjs";
import { safeEqual } from "./compare.mjs";
import { base64url, fromBase64url } from "./encoding.mjs";
import { logEvent } from "./log.mjs";

export const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";
export const ACCESS_COOKIE = "CF_Authorization";

/** How long an unknown kid waits before it may refetch the keys again, so a forged kid cannot hammer the endpoint. */
export const REFETCH_COOLDOWN_MS = 30_000;

/**
 * The issuer Access writes, https://<team domain>, from the team domain as either site keeps it: with or without the
 * scheme, with or without a trailing slash. Null when it is missing or not a <team>.cloudflareaccess.com host.
 * @param {string | undefined} teamDomain
 * @returns {string | null}
 */
export function accessIssuer(teamDomain) {
  const host = (teamDomain ?? "")
    .trim()
    .replace(/^https:\/\//i, "")
    .replace(/\/+$/, "");
  // Only an Access team host: the keys fetched from it are trusted to sign who a request is.
  if (!host || !/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(host)) return null;
  return `https://${host.toLowerCase()}`;
}

/** @typedef {import("./access-login.d.mts").Jwk} Jwk */
/** @typedef {import("./access-login.d.mts").KeySource} KeySource */

/** @type {Map<string, { keys: Jwk[], fetchedAt: number }>} */
const cachedKeys = new Map();

/**
 * The team's signing keys at https://<team domain>/cdn-cgi/access/certs, cached per isolate. A kid not in the cache
 * refetches, at most once per REFETCH_COOLDOWN_MS. A failed fetch, an error status or a body with no key list THROWS.
 * @param {string} teamDomain
 * @returns {KeySource}
 */
export function accessKeys(teamDomain) {
  const issuer = accessIssuer(teamDomain);
  if (!issuer) throw new Error("accessKeys: the Access team domain is missing or not a host");
  const url = `${issuer}/cdn-cgi/access/certs`;
  return async (kid, fresh) => {
    let entry = cachedKeys.get(url);
    if (!entry || (fresh && Date.now() - entry.fetchedAt >= REFETCH_COOLDOWN_MS)) {
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`the Access keys at ${url} answered ${response.status}`);
      const body = /** @type {{ keys?: unknown }} */ (await response.json().catch(() => ({})));
      if (!Array.isArray(body.keys)) throw new Error(`the Access keys at ${url} are not a key set`);
      entry = { keys: /** @type {Jwk[]} */ (body.keys), fetchedAt: Date.now() };
      cachedKeys.set(url, entry);
    }
    return entry.keys.find((key) => key.kid === kid);
  };
}

/**
 * The value of one cookie, or null.
 * @param {Request} request
 * @param {string} name
 */
function cookieValue(request, name) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

/**
 * The Access token a request carries: the header, else (with `cookie`) the CF_Authorization cookie, else null. The
 * header is added only on paths an Access application covers; the cookie rides on every path of the host.
 * @param {Request} request
 * @param {{ cookie?: boolean }} [options]
 * @returns {string | null}
 */
export function accessToken(request, { cookie = false } = {}) {
  return request.headers.get(ACCESS_JWT_HEADER) || (cookie ? cookieValue(request, ACCESS_COOKIE) : null);
}

/**
 * One Access application's verdict on a token: the claims, or the reason it is refused (`verifyJwt`'s reasons:
 * malformed, algorithm, unknown-key, signature, issuer, audience, expired, not-yet-valid).
 * @param {string} token
 * @param {KeySource} keys
 * @param {{ issuer: string, audience: string, now?: number }} expect `now` in epoch milliseconds
 * @returns {Promise<import("./access-login.d.mts").JwtVerdict>}
 */
export function verifyAccessToken(token, keys, expect) {
  return verifyJwt(token, keys, expect);
}

/**
 * One Access application's verdict on a request. `not-configured` when the team domain or the audience is missing,
 * `no-token` when the request carries none, a token reason when it fails; otherwise the token's claims, which the
 * caller reads for `email` (a person) or `common_name` (a service token). Throws when the keys cannot be fetched.
 * @param {Request} request
 * @param {{ teamDomain: string | undefined, audience: string | undefined, cookie?: boolean, keys?: KeySource, now?: number }} options
 * @returns {Promise<import("./access.d.mts").AccessVerdict>}
 */
export async function verifyAccessRequest(request, { teamDomain, audience, cookie = false, keys, now }) {
  const issuer = accessIssuer(teamDomain);
  const aud = audience?.trim();
  if (!issuer || !aud) return { ok: false, reason: "not-configured" };
  const token = accessToken(request, { cookie });
  if (!token) return { ok: false, reason: "no-token" };
  return verifyJwt(token, keys ?? accessKeys(issuer), { issuer, audience: aud, now });
}

/**
 * The admin list from the environment: ADMIN_EMAILS, else ADMIN_EMAIL, split on commas, trimmed and lower-cased. Unset
 * is an empty list, which admits nobody.
 * @param {{ ADMIN_EMAILS?: string, ADMIN_EMAIL?: string }} env
 * @returns {string[]}
 */
export function adminEmails(env) {
  return emailList(env.ADMIN_EMAILS ?? env.ADMIN_EMAIL);
}

/** @param {string | readonly string[] | undefined | null} value */
function emailList(value) {
  const items = typeof value === "string" ? value.split(",") : (value ?? []);
  return items.map((email) => String(email).trim().toLowerCase()).filter((email) => email.length > 0);
}

/**
 * The admin Access signed this request for, or null. `admins` (a list, or a comma-separated string; default
 * `adminEmails(env)`) is who may pass; a site that checks the token against its own signed-in user passes that one
 * email. With ACCESS_DEV_BYPASS="1" on a localhost URL the first admin passes with no token.
 * @param {Request} request
 * @param {Partial<import("./access.d.mts").AccessSecrets> & { ADMIN_EMAILS?: string, ADMIN_EMAIL?: string }} env
 * @param {{ admins?: string | readonly string[], keys?: import("./access-login.d.mts").KeySource, now?: number }} [options]
 * @returns {Promise<{ email: string } | null>}
 */
export async function accessAdmin(request, env, { admins, keys, now } = {}) {
  const list = admins === undefined ? adminEmails(env) : emailList(admins);
  if (list.length === 0) return null;
  if (env.ACCESS_DEV_BYPASS === "1" && new URL(request.url).hostname === "localhost") return { email: /** @type {string} */ (list[0]) };
  try {
    const verdict = await verifyAccessRequest(request, { teamDomain: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD, cookie: true, keys, now });
    if (!verdict.ok) return null;
    const email = typeof verdict.claims.email === "string" ? verdict.claims.email.trim().toLowerCase() : "";
    return email && list.includes(email) ? { email } : null;
  } catch (error) {
    // The keys could not be fetched: refused, never let through.
    logEvent("access_keys_unreachable", { error }, { level: "error" });
    return null;
  }
}

/**
 * Where an admin without Access's cookie goes: `path` (the one path the Access application covers, which sets the
 * cookie and comes back), with the current page as `next`.
 * @param {Request} request
 * @param {{ path?: string }} [options]
 * @returns {string}
 */
export function accessSignInUrl(request, { path = "/admin/access" } = {}) {
  const url = new URL(request.url);
  return `${path}?next=${encodeURIComponent(url.pathname + url.search)}`;
}

/**
 * The page to land on after Access: `next` when it is a path under `prefix` on this site (and not the Access path
 * itself, which would loop), else `prefix`.
 * @param {string | null | undefined} next
 * @param {{ prefix?: string, path?: string }} [options]
 * @returns {string}
 */
export function safeAdminNext(next, { prefix = "/admin", path = "/admin/access" } = {}) {
  if (!next || next.includes("\\") || next.startsWith(path)) return prefix;
  if (next === prefix || next.startsWith(`${prefix}/`) || next.startsWith(`${prefix}?`)) return next;
  return prefix;
}

/** An admin's Access session ends after this long without a request: an hour, in seconds. */
export const ADMIN_IDLE_SECONDS = 60 * 60;

/** The cookie holding the admin's last request time, signed for their Access session. */
export const ADMIN_SEEN_COOKIE = "__Host-admin-seen";

/** Access's logout: it revokes the session in every application and clears the cookie, so the next visit signs in. */
export const ACCESS_LOGOUT_PATH = "/cdn-cgi/access/logout";

/**
 * The Access token's claims, read without verifying them: `accessAdmin` verifies; these only time and name a session.
 * @param {string} token
 * @returns {Record<string, unknown>}
 */
function tokenClaims(token) {
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64url(token.split(".")[1] ?? "")));
  } catch {
    return {};
  }
}

/**
 * HMAC-SHA-256 of the time, keyed by the Access session (the token's `sub` and `iat`, which stay the same if Access
 * signs the token again), so a stale cookie or one copied from another session is ignored.
 * @param {Record<string, unknown>} claims
 * @param {string} time
 */
async function seenMac(claims, time) {
  const enc = new TextEncoder();
  const secret = enc.encode(`${claims.sub}.${claims.iat}`);
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(time))));
}

/** The request header a page sets on its polling fetches, so they are timed but do not count as activity. */
export const BACKGROUND_HEADER = "x-background";

/**
 * Whether a request is the page's own, not the admin's: `X-Background: 1`, which a page sets on its polling and
 * refresh fetches, or a speculative load the browser made (`Sec-Purpose: prefetch`, as from `./prefetch`'s rules).
 * @param {Request} request
 */
function isBackground(request) {
  return request.headers.get(BACKGROUND_HEADER) === "1" || /\bprefetch\b/.test(request.headers.get("sec-purpose") ?? "");
}

/**
 * The idle check for a request on an admin path, run in the Worker's fetch before the app. The session is the Access
 * token's (`sub` and `iat`), or `session` for a host whose own sign-in is not an Access token on the request (`id` an
 * opaque value only the server can make, `signedInAt` epoch milliseconds). With neither there is nothing to time and it
 * answers `{ idle: false }` (Access or `accessAdmin` refuses the request). The last request is the seen cookie's time
 * when its signature matches this session, else the sign-in time. Past `idleSeconds`: `{ idle: true, response }`, a
 * redirect to Access's logout; otherwise `{ idle: false, cookie }`, the Set-Cookie that records this request, for the
 * site to append to its response. A background request (isBackground) is checked but records nothing, so a page left
 * polling does not keep its admin signed in. A site with two Access apps (each its own token) gives each its own
 * `cookieName` (a `__Host-` name), so moving between them does not read the other's cookie as no request.
 * @param {Request} request
 * @param {{ idleSeconds?: number, now?: number, session?: { id: string, signedInAt: number } | null, cookieName?: string }} [options] `now` in epoch milliseconds
 * @returns {Promise<{ idle: true, response: Response } | { idle: false, cookie?: string }>}
 */
export async function adminIdle(request, { idleSeconds = ADMIN_IDLE_SECONDS, now = Date.now(), session, cookieName = ADMIN_SEEN_COOKIE } = {}) {
  /** @type {Record<string, unknown>} */
  let claims;
  if (session) {
    claims = { sub: session.id, iat: Math.floor(session.signedInAt / 1000) };
  } else {
    const token = accessToken(request, { cookie: true });
    if (!token) return { idle: false };
    claims = tokenClaims(token);
  }
  const seconds = Math.floor(now / 1000);
  const [time, mac] = (cookieValue(request, cookieName) ?? "").split(".");
  const iat = typeof claims.iat === "number" ? claims.iat : null;
  const seen = time && mac && (await safeEqual(mac, await seenMac(claims, time))) ? Number(time) : iat;
  if (seen === null || seconds - seen > idleSeconds) {
    logEvent("admin_idle_logout", { idleSeconds });
    return {
      idle: true,
      response: new Response(null, {
        status: 302,
        headers: {
          Location: ACCESS_LOGOUT_PATH,
          "Cache-Control": "no-store",
          "Set-Cookie": `${cookieName}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`,
        },
      }),
    };
  }
  if (isBackground(request)) return { idle: false };
  const value = `${seconds}.${await seenMac(claims, String(seconds))}`;
  return { idle: false, cookie: `${cookieName}=${value}; Path=/; Max-Age=${idleSeconds}; Secure; HttpOnly; SameSite=Lax` };
}

/**
 * `adminIdle` around a site's handler, for its Worker's fetch: on a path under one of `prefixes` (default `/admin`),
 * an idle admin gets the logout redirect and an active one's response carries the seen cookie; every other path goes
 * straight to `handle`.
 * @param {Request} request
 * @param {() => Promise<Response>} handle
 * @param {{ prefixes?: readonly string[], idleSeconds?: number, session?: { id: string, signedInAt: number } | null, cookieName?: string }} [options]
 * @returns {Promise<Response>}
 */
export async function withAdminIdle(request, handle, { prefixes = ["/admin"], idleSeconds, session, cookieName } = {}) {
  const { pathname } = new URL(request.url);
  if (!prefixes.some((prefix) => prefix === "/" || pathname === prefix || pathname.startsWith(`${prefix}/`))) return handle();
  const gate = await adminIdle(request, { idleSeconds, session, cookieName });
  if (gate.idle) return gate.response;
  const response = await handle();
  // A WebSocket upgrade (101) goes back untouched: copying it would drop its socket.
  if (!gate.cookie || response.status === 101) return response;
  // A response from fetch has immutable headers.
  const out = new Response(response.body, response);
  out.headers.append("Set-Cookie", gate.cookie);
  return out;
}
