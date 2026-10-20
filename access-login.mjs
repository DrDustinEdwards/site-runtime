/**
 * The sign-in round trip with Cloudflare Access for SaaS (OIDC) as the upstream identity, for every MCP server and
 * app in the family that signs a person in (2026-10-20). Before this, four servers each carried their own copy:
 * Capsid's and Carrel's, and the identical pair in the two admin MCPs, which kept the sign-in state, the PKCE
 * verifier and the nonce in an unsigned cookie. This keeps the strongest of each:
 *
 * - The state is held server-side, in the caller's store (a KV namespace), for ten minutes, and used once (Capsid).
 *   The browser holds only a random binding value; the stored state keeps its SHA-256 digest. A cookie derived from
 *   the state token would bind nothing, since the callback URL carries the token (Capsid, Grok audit 2026-10, S6).
 * - A cookie that does not match leaves the state in place, so a stranger holding the callback URL cannot spend the
 *   browser's sign-in. The state is consumed after the token exchange, so a passing Access error does not burn it.
 * - PKCE (S256) and an OIDC nonce on every sign-in; both stay on the server.
 * - The ID token is verified with WebCrypto against the SaaS app's published keys (RS256), so this package carries
 *   no JWT library: issuer, audience, expiry and not-before with 60 seconds of skew, the nonce, `email_verified` not
 *   false, and an email present. A kid not in the cached keys refetches once, so a key rotation does not lock the
 *   door (the admin MCPs).
 * - Access's own refusal (`error=` on the callback) is named, not reported as a missing code (Capsid).
 * - Fails closed: a missing setting keeps the door shut.
 *
 * Who is admitted stays with the caller (`isAllowed`), as does what it stores and does with the admitted email.
 * Every endpoint derives from the team domain and the client id, as the SaaS app's discovery document states them.
 */

/** How long a started sign-in stays usable: the stored state and the binding cookie. */
export const STATE_TTL_SECONDS = 600;

const MAX_NAME = 80;
const SKEW_SECONDS = 60;

/**
 * The SaaS app's endpoints, or null while any setting is missing: the sign-in is then closed. The team domain is
 * https://<team>.cloudflareaccess.com, as the Access dashboard shows it; a trailing slash is ignored.
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

export const NOT_CONFIGURED =
  "the sign-in is not configured (ACCESS_TEAM_DOMAIN, ACCESS_SAAS_CLIENT_ID, ACCESS_SAAS_CLIENT_SECRET), so it is closed";

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

/** @param {string} value */
async function sha256Hex(value) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Equal strings, compared in time that does not depend on where they differ. @param {string} a @param {string} b */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** @param {Request} request @param {string} name */
function cookie(request, name) {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return undefined;
}

/** @param {string} message @param {number} status */
function refusal(message, status) {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
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
 * The payload of an RS256 JWT signed by one of `keys`, issued by `issuer` for `audience` and in date (60 seconds of
 * skew), or null. A kid not in the cached set refetches once.
 * @param {string} token
 * @param {KeySource} keys
 * @param {{ issuer: string, audience: string, now?: number }} expect
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function verifyIdToken(token, keys, expect) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  /** @type {{ alg?: unknown, kid?: unknown }} */
  let header;
  /** @type {Record<string, unknown>} */
  let payload;
  try {
    header = JSON.parse(new TextDecoder().decode(fromBase64url(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(fromBase64url(parts[1])));
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  if (header?.alg !== "RS256" || typeof header.kid !== "string") return null;
  const jwk = (await keys(header.kid, false)) ?? (await keys(header.kid, true));
  if (!jwk || jwk.kty !== "RSA") return null;
  let valid = false;
  try {
    const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromBase64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  } catch {
    return null;
  }
  if (!valid) return null;
  const now = Math.floor((expect.now ?? Date.now()) / 1000);
  if (payload.iss !== expect.issuer) return null;
  const aud = payload.aud;
  if (!(aud === expect.audience || (Array.isArray(aud) && aud.includes(expect.audience)))) return null;
  if (typeof payload.exp !== "number" || payload.exp + SKEW_SECONDS < now) return null;
  if (payload.nbf !== undefined && (typeof payload.nbf !== "number" || payload.nbf - SKEW_SECONDS > now)) return null;
  return payload;
}

/**
 * Stores `stored` against a fresh state token and sends the browser to Access. The response sets the binding cookie
 * and any `extraCookies` the caller passes.
 * @param {Request} request
 * @param {import("./access-login.d.mts").StartOptions} options
 * @returns {Promise<Response>}
 */
export async function startAccessLogin(request, { saas, store, flow, stored, extraCookies = [] }) {
  if (!saas) return refusal(NOT_CONFIGURED, 503);
  const stateToken = crypto.randomUUID();
  const binding = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
  const signIn = {
    stored,
    verifier: base64url(crypto.getRandomValues(new Uint8Array(32))),
    nonce: crypto.randomUUID(),
    binding: await sha256Hex(binding),
  };
  await store.put(`${flow.kvPrefix}${stateToken}`, JSON.stringify(signIn), { expirationTtl: STATE_TTL_SECONDS });
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signIn.verifier))));
  const target = new URL(saas.authorizationUrl);
  target.searchParams.set("client_id", saas.clientId);
  target.searchParams.set("redirect_uri", `${new URL(request.url).origin}${flow.callbackPath}`);
  target.searchParams.set("response_type", "code");
  target.searchParams.set("scope", "openid email profile");
  target.searchParams.set("state", stateToken);
  target.searchParams.set("nonce", signIn.nonce);
  target.searchParams.set("code_challenge", challenge);
  target.searchParams.set("code_challenge_method", "S256");
  const headers = new Headers({ Location: target.href, "Cache-Control": "no-store" });
  headers.append("Set-Cookie", `${flow.stateCookie}=${binding}; HttpOnly; Secure; SameSite=Lax; Path=${flow.cookiePath}; Max-Age=${STATE_TTL_SECONDS}`);
  for (const extra of extraCookies) headers.append("Set-Cookie", extra);
  return new Response(null, { status: 302, headers });
}

/** The Set-Cookie value that clears a flow's binding cookie. @param {import("./access-login.d.mts").LoginFlow} flow */
export function clearStateCookie(flow) {
  return `${flow.stateCookie}=; HttpOnly; Secure; SameSite=Lax; Path=${flow.cookiePath}; Max-Age=0`;
}

/**
 * Checks the callback's state against the binding cookie and the store, exchanges the code with PKCE, verifies the
 * ID token and asks `isAllowed`. `parse` turns the stored value back into what was stored; if it throws, the state
 * is deleted and the callback refused before anything reaches Access.
 * @template T
 * @param {Request} request
 * @param {import("./access-login.d.mts").CompleteOptions<T>} options
 * @returns {Promise<import("./access-login.d.mts").AccessLoginResult<T>>}
 */
export async function completeAccessLogin(request, { saas, store, flow, isAllowed, parse, keys, now }) {
  /** @param {string} message @param {number} status */
  const fail = (message, status) => /** @type {const} */ ({ ok: false, response: refusal(message, status) });
  if (!saas) return fail(NOT_CONFIGURED, 503);
  const url = new URL(request.url);
  const upstreamError = url.searchParams.get("error");
  if (upstreamError) return fail(`the sign-in was refused by Access: ${upstreamError.slice(0, 80)}. ${flow.restartHint}`, 403);
  const code = url.searchParams.get("code");
  const stateToken = url.searchParams.get("state");
  if (!code || !stateToken) return fail(`missing code or state on the callback. ${flow.restartHint}`, 400);

  const notThisBrowser = `state validation failed: this browser did not start the sign-in. ${flow.restartHint}`;
  const presented = cookie(request, flow.stateCookie);
  if (!presented) return fail(notThisBrowser, 403);
  const stateKey = `${flow.kvPrefix}${stateToken}`;
  const raw = await store.get(stateKey);
  if (!raw) return fail(`the sign-in expired or was already used. ${flow.restartHint}`, 403);
  /** @type {{ stored: string, verifier: string, nonce: string, binding: string }} */
  let signIn;
  try {
    signIn = JSON.parse(raw);
    if (typeof signIn.stored !== "string" || typeof signIn.verifier !== "string" || typeof signIn.nonce !== "string" || typeof signIn.binding !== "string") {
      throw new Error("shape");
    }
  } catch {
    await store.delete(stateKey);
    return fail(`the stored sign-in is unreadable. ${flow.restartHint}`, 403);
  }
  if (!timingSafeEqual(await sha256Hex(presented), signIn.binding)) return fail(notThisBrowser, 403);
  /** @type {T} */
  let state;
  try {
    state = parse ? parse(signIn.stored) : /** @type {T} */ (/** @type {unknown} */ (signIn.stored));
  } catch {
    await store.delete(stateKey);
    return fail(`the stored sign-in is unreadable. ${flow.restartHint}`, 403);
  }

  const tokenResponse = await fetch(saas.tokenUrl, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${url.origin}${flow.callbackPath}`,
      client_id: saas.clientId,
      client_secret: saas.clientSecret,
      code_verifier: signIn.verifier,
    }),
  });
  if (!tokenResponse.ok) return fail(`the Access token exchange failed (${tokenResponse.status})`, 502);
  const tokens = /** @type {{ id_token?: unknown }} */ (await tokenResponse.json().catch(() => ({})));
  if (typeof tokens.id_token !== "string") return fail("the Access token exchange returned no ID token", 502);
  // Consumed after the exchange: Access honours a code once, which bounds a replay.
  await store.delete(stateKey);

  const payload = await verifyIdToken(tokens.id_token, keys ?? remoteKeys(saas.jwksUrl), {
    issuer: saas.issuer,
    audience: saas.clientId,
    now: now?.getTime(),
  });
  const unverified = (/** @type {string} */ reason) => fail(`the sign-in could not be verified: ${reason}. ${flow.restartHint}`, 403);
  if (!payload) return unverified("invalid ID token");
  if (payload.nonce !== signIn.nonce) return unverified("nonce mismatch");
  if (payload.email_verified === false) return unverified("email not verified");
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  if (!email) return unverified("no email");
  if (!(await isAllowed(email))) return fail(flow.deniedMessage, 403);
  const name = typeof payload.name === "string" ? payload.name.trim().slice(0, MAX_NAME) : "";
  return name ? { ok: true, email, name, state } : { ok: true, email, state };
}
