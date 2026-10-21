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
 * Not here, because each site does it its own way: who a verified token is (an email, a service token's common_name),
 * case folding, the local development bypass, and what a refusal shows.
 */

import { verifyJwt } from "./access-login.mjs";

export const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";
export const ACCESS_COOKIE = "CF_Authorization";

/** How long an unknown kid waits before it may refetch the keys again, so a forged kid cannot hammer the endpoint. */
export const REFETCH_COOLDOWN_MS = 30_000;

/**
 * The issuer Access writes, https://<team domain>, from the team domain as either site keeps it: with or without the
 * scheme, with or without a trailing slash. Null when it is missing or not a bare host.
 * @param {string | undefined} teamDomain
 * @returns {string | null}
 */
export function accessIssuer(teamDomain) {
  const host = (teamDomain ?? "")
    .trim()
    .replace(/^https:\/\//i, "")
    .replace(/\/+$/, "");
  if (!host || !/^[A-Za-z0-9.-]+$/.test(host)) return null;
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
