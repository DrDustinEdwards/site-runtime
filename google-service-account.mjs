/**
 * A Google service account's access token: its JSON key file checked, a signed RS256 assertion exchanged at Google's
 * token endpoint (RFC 7523, Google's "OAuth 2.0 for server to server applications"), and the hour's token kept per
 * isolate. Capsid's Search Console reader and Carrel's Drive index each had their own, one of them on `jose`.
 */

import { timedFetch } from "./http.mjs";
import { signJwt } from "./jwt.mjs";

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * @typedef {{ clientEmail: string; privateKey: string; privateKeyId: string | null; tokenUri: string }} ServiceAccountKey
 */

/**
 * The key file a person pasted into `name` (a secret's name, for the message), or what is wrong with it. A key file
 * whose token_uri is not Google's is refused: the signed assertion would go there.
 * @param {string | null | undefined} raw
 * @param {string} name
 * @returns {{ ok: true; key: ServiceAccountKey } | { ok: false; state: "not-connected" | "misconfigured"; detail: string }}
 */
export function parseServiceAccountKey(raw, name) {
  const text = raw?.trim();
  if (!text) return { ok: false, state: "not-connected", detail: `${name} is not set.` };
  /** @type {Record<string, unknown>} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      state: "misconfigured",
      detail: `${name} is not JSON; set it to the whole key file Google Cloud downloaded.`,
    };
  }
  const { type, client_email, private_key, private_key_id, token_uri } = parsed ?? {};
  if (
    (type !== undefined && type !== "service_account") ||
    typeof client_email !== "string" ||
    typeof private_key !== "string"
  ) {
    return {
      ok: false,
      state: "misconfigured",
      detail: `${name} is not a service account key file (type, client_email, private_key).`,
    };
  }
  if (!private_key.includes("BEGIN PRIVATE KEY"))
    return {
      ok: false,
      state: "misconfigured",
      detail: `${name}'s private_key is not a PKCS#8 PEM key.`,
    };
  const tokenUri = typeof token_uri === "string" ? token_uri : GOOGLE_TOKEN_URL;
  if (tokenUri !== GOOGLE_TOKEN_URL)
    return {
      ok: false,
      state: "misconfigured",
      detail: `${name}'s token_uri is ${tokenUri}, not Google's.`,
    };
  return {
    ok: true,
    key: {
      clientEmail: client_email,
      privateKey: private_key,
      privateKeyId: typeof private_key_id === "string" ? private_key_id : null,
      tokenUri,
    },
  };
}

/** @type {Map<string, { token: string; expiresAt: number }>} */
const tokens = new Map();

/** Forget every cached token (tests, or a key that was just rotated). */
export function clearServiceAccountTokens() {
  tokens.clear();
}

/**
 * An access token for `scopes`, reused until five minutes before it expires. A refusal throws with Google's error
 * (invalid_grant is a deleted, disabled or expired key).
 * @param {ServiceAccountKey} key
 * @param {string[]} scopes
 * @param {{ fetcher?: typeof fetch; now?: number }} [options]
 * @returns {Promise<string>}
 */
export async function serviceAccountToken(key, scopes, options = {}) {
  const fetcher = options.fetcher ?? timedFetch;
  const now = options.now ?? Date.now();
  const cacheKey = `${key.clientEmail} ${key.privateKeyId ?? ""} ${scopes.join(" ")}`;
  const cached = tokens.get(cacheKey);
  if (cached && cached.expiresAt - 5 * 60_000 > now) return cached.token;
  const iat = Math.floor(now / 1000);
  const assertion = await signJwt({
    alg: "RS256",
    key: key.privateKey,
    header: key.privateKeyId ? { typ: "JWT", kid: key.privateKeyId } : { typ: "JWT" },
    claims: {
      scope: scopes.join(" "),
      iss: key.clientEmail,
      aud: key.tokenUri,
      iat,
      exp: iat + 3600,
    },
  });
  const resp = await fetcher(key.tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });
  const body =
    /** @type {{ access_token?: string; expires_in?: number; error?: string; error_description?: string }} */ (
      await resp.json().catch(() => ({}))
    );
  if (!resp.ok || !body.access_token) {
    const why = [body.error, body.error_description].filter(Boolean).join(": ").slice(0, 200);
    throw new Error(
      `Google refused the service account key (${resp.status}${why ? ` ${why}` : ""}).`,
    );
  }
  tokens.set(cacheKey, {
    token: body.access_token,
    expiresAt: now + (body.expires_in ?? 3600) * 1000,
  });
  return body.access_token;
}
