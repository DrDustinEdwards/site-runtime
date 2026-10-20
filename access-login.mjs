/**
 * The upstream sign-in with Cloudflare Access for SaaS (OIDC), the one login every MCP server in the family uses
 * (2026-10-18). Carrel, Foxing Admin and Dustin Edwards Admin each carried the same four functions until 2026-10-20,
 * two verifying the ID token with WebCrypto and one with jose; this is the one copy (2026-10-20).
 *
 * The state of a sign-in in flight (the client's request, the PKCE verifier, the nonce) is not kept here. An MCP
 * server keeps it with @cloudflare/workers-oauth-provider's beginUpstream and finishUpstream, which hold it server-side,
 * bind it to the browser by a cookie and spend it once; `newSignIn` makes what goes in it.
 *
 * - Every endpoint derives from the team domain and the SaaS app's client id, as the Access dashboard shows them.
 *   A missing setting keeps the door shut.
 * - PKCE (S256) and an OIDC nonce on every sign-in.
 * - The ID token is verified with WebCrypto against the SaaS app's published keys, so there is no JWT library: RS256
 *   only, the issuer, the audience, expiry and not-before with 60 seconds of skew (Access and Workers clocks are
 *   not the same clock), the nonce, `email_verified` not false, and an email present. A kid not in the cached keys
 *   refetches once, so a key rotation does not lock the door.
 *
 * Who is admitted is the caller's: the email comes back, and the caller compares it with its administrator.
 */

const SKEW_SECONDS = 60;
const MAX_NAME = 80;

/**
 * The SaaS app's endpoints, or null while any setting is missing. ACCESS_TEAM_DOMAIN is the team domain as the
 * dashboard shows it, https://<team>.cloudflareaccess.com; a trailing slash is ignored.
 * @param {{ ACCESS_TEAM_DOMAIN?: string, ACCESS_SAAS_CLIENT_ID?: string, ACCESS_SAAS_CLIENT_SECRET?: string }} env
 */
export function accessSaas(env) {
  const team = env.ACCESS_TEAM_DOMAIN?.trim().replace(/\/+$/, "");
  const clientId = env.ACCESS_SAAS_CLIENT_ID?.trim();
  const clientSecret = env.ACCESS_SAAS_CLIENT_SECRET?.trim();
  if (!team || !clientId || !clientSecret) return null;
  const issuer = `${team}/cdn-cgi/access/sso/oidc/${encodeURIComponent(clientId)}`;
  return { clientId, clientSecret, issuer, authorizationUrl: `${issuer}/authorization`, tokenUrl: `${issuer}/token`, jwksUrl: `${issuer}/jwks` };
}

/** @param {Uint8Array} bytes */
function base64url(bytes) {
  let raw = "";
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** @param {string} value */
function fromBase64url(value) {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** A fresh PKCE verifier (43 characters, 256 random bits) and OIDC nonce for one sign-in. Keep both server-side. */
export function newSignIn() {
  return { verifier: base64url(crypto.getRandomValues(new Uint8Array(32))), nonce: crypto.randomUUID() };
}

/**
 * Where the browser goes to sign in with Access.
 * @param {import("./access-login.d.mts").AccessSaas} saas
 * @param {{ redirectUri: string, state: string, verifier: string, nonce: string }} input
 */
export async function authorizationUrl(saas, input) {
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.verifier))));
  const url = new URL(saas.authorizationUrl);
  url.searchParams.set("client_id", saas.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.href;
}

/** @typedef {JsonWebKey & { kid?: string }} Jwk */
/** @typedef {(kid: string, fresh: boolean) => Promise<Jwk | undefined>} KeySource */

/** @type {Map<string, Jwk[]>} */
const cachedKeys = new Map();

/** The keys at a JWKS URL, cached per isolate; `fresh` refetches. @param {string} jwksUrl @returns {KeySource} */
export function remoteKeys(jwksUrl) {
  return async (kid, fresh) => {
    let keys = fresh ? undefined : cachedKeys.get(jwksUrl);
    if (!keys) {
      const response = await fetch(jwksUrl, { headers: { Accept: "application/json" } });
      if (!response.ok) return undefined;
      const body = /** @type {{ keys?: Jwk[] }} */ (await response.json().catch(() => ({})));
      keys = Array.isArray(body.keys) ? body.keys : [];
      cachedKeys.set(jwksUrl, keys);
    }
    return keys.find((key) => key.kid === kid);
  };
}

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
 * @returns {Promise<import("./access-login.d.mts").JwtVerdict>}
 */
export async function verifyJwt(token, keys, expect) {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  /** @type {{ alg?: unknown, kid?: unknown }} */
  let header;
  /** @type {unknown} */
  let parsed;
  try {
    header = JSON.parse(new TextDecoder().decode(fromBase64url(parts[0])));
    parsed = JSON.parse(new TextDecoder().decode(fromBase64url(parts[1])));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof header !== "object" || header === null) return { ok: false, reason: "malformed" };
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ok: false, reason: "malformed" };
  const payload = /** @type {Record<string, unknown>} */ (parsed);
  if (header.alg !== "RS256") return { ok: false, reason: "algorithm" };
  if (typeof header.kid !== "string") return { ok: false, reason: "unknown-key" };
  const jwk = (await keys(header.kid, false)) ?? (await keys(header.kid, true));
  if (!jwk || jwk.kty !== "RSA") return { ok: false, reason: "unknown-key" };
  let valid = false;
  try {
    const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromBase64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  } catch {
    return { ok: false, reason: "signature" };
  }
  if (!valid) return { ok: false, reason: "signature" };
  const now = Math.floor((expect.now ?? Date.now()) / 1000);
  if (payload.iss !== expect.issuer) return { ok: false, reason: "issuer" };
  const aud = payload.aud;
  if (!(aud === expect.audience || (Array.isArray(aud) && aud.includes(expect.audience)))) return { ok: false, reason: "audience" };
  if (typeof payload.exp !== "number" || payload.exp + SKEW_SECONDS < now) return { ok: false, reason: "expired" };
  if (payload.nbf !== undefined && (typeof payload.nbf !== "number" || payload.nbf - SKEW_SECONDS > now)) return { ok: false, reason: "not-yet-valid" };
  return { ok: true, claims: payload };
}

/**
 * The payload of an RS256 JWT signed by one of `keys`, issued by `issuer` for `audience` and in date, or null
 * (`verifyJwt` without the reason).
 * @param {string} token
 * @param {KeySource} keys
 * @param {{ issuer: string, audience: string, now?: number }} expect
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function verifyIdToken(token, keys, expect) {
  const verdict = await verifyJwt(token, keys, expect);
  return verdict.ok ? verdict.claims : null;
}

/**
 * Exchanges Access's code for tokens and verifies the ID token: signed by the SaaS app's keys, issued by it, for this
 * client, carrying this sign-in's nonce, and naming an email that is not marked unverified. Anything else is a
 * refusal with a reason a log can carry; no token or secret is in it.
 * @param {import("./access-login.d.mts").AccessSaas} saas
 * @param {{ code: string, redirectUri: string, verifier: string, nonce: string }} input
 * @param {KeySource} [keys]
 * @returns {Promise<import("./access-login.d.mts").SignedIn>}
 */
export async function finishSignIn(saas, input, keys = remoteKeys(saas.jwksUrl)) {
  const response = await fetch(saas.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: saas.clientId,
      client_secret: saas.clientSecret,
      code_verifier: input.verifier,
    }),
  });
  if (!response.ok) return { ok: false, reason: `token-exchange-${response.status}` };
  const tokens = /** @type {{ id_token?: unknown }} */ (await response.json().catch(() => ({})));
  if (typeof tokens.id_token !== "string") return { ok: false, reason: "no-id-token" };

  const payload = await verifyIdToken(tokens.id_token, keys, { issuer: saas.issuer, audience: saas.clientId });
  if (!payload) return { ok: false, reason: "invalid-id-token" };
  if (payload.nonce !== input.nonce) return { ok: false, reason: "nonce-mismatch" };
  if (payload.email_verified === false) return { ok: false, reason: "email-not-verified" };
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  if (!email) return { ok: false, reason: "no-email" };
  const name = typeof payload.name === "string" ? payload.name.trim().slice(0, MAX_NAME) : "";
  return name ? { ok: true, email, name } : { ok: true, email };
}
