/**
 * Web Push sent from a Worker: one payload encrypted for one browser subscription (RFC 8291, aes128gcm) and the
 * request to its push service signed with the VAPID key (RFC 8292), on WebCrypto alone. From Capsid's phone alerts
 * (src/web-push.ts); what to push and when stays the site's.
 *
 * The VAPID key is one secret: a P-256 private key as a JWK (its x and y are the public half, which the page hands the
 * browser when it subscribes).
 */

import { base64url, concatBytes, fromBase64url } from "./encoding.mjs";
import { timedFetch } from "./http.mjs";
import { signJwt } from "./jwt.mjs";

const RECORD_SIZE = 4096;
const TTL_SECONDS = 24 * 60 * 60;
const JWT_LIFETIME_SECONDS = 12 * 60 * 60;

// The push services a subscription may name. The Worker POSTs to the endpoint the browser
// gave, so an endpoint anywhere else is refused before it is stored: a stored endpoint is
// a URL the Worker will call every time something is urgent.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+\.push\.apple\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
];

const utf8 = (/** @type {string} */ s) => new Uint8Array(new TextEncoder().encode(s));

/** Why a subscription cannot be stored, or null. Checked at subscribe time, before any
 *  row is written, and again before each send.
 * @param {Partial<import("./web-push.d.mts").PushSubscriptionKeys>} sub
 * @returns {string | null}
 */
export function subscriptionProblem(sub) {
  if (typeof sub.endpoint !== "string" || sub.endpoint.length > 1024)
    return "the subscription has no endpoint.";
  let url;
  try {
    url = new URL(sub.endpoint);
  } catch {
    return "the subscription's endpoint is not a URL.";
  }
  if (url.protocol !== "https:") return "the subscription's endpoint is not https.";
  if (!PUSH_HOSTS.some((h) => h.test(url.hostname)))
    return `the subscription's endpoint is on ${url.hostname}, which is not a known push service.`;
  try {
    if (typeof sub.p256dh !== "string" || fromBase64url(sub.p256dh).length !== 65)
      return "the subscription's p256dh key is not a 65-byte P-256 point.";
    if (typeof sub.auth !== "string" || fromBase64url(sub.auth).length !== 16)
      return "the subscription's auth secret is not 16 bytes.";
  } catch {
    return "the subscription's keys are not base64url.";
  }
  return null;
}

/**
 * The VAPID key from its secret, or why it cannot be used.
 * @param {string | undefined} secret
 * @returns {import("./web-push.d.mts").VapidKey | string}
 */
export function readVapidKey(secret) {
  if (!secret) return "VAPID_PRIVATE_KEY is not set, so no push can be signed.";
  /** @type {JsonWebKey} */
  let jwk;
  try {
    jwk = JSON.parse(secret);
  } catch {
    return "VAPID_PRIVATE_KEY is not JSON: it must be a P-256 private key as a JWK.";
  }
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d || !jwk.x || !jwk.y)
    return "VAPID_PRIVATE_KEY is not a P-256 private key as a JWK (kty EC, crv P-256, d, x and y).";
  let point;
  try {
    point = concatBytes(new Uint8Array([4]), fromBase64url(jwk.x), fromBase64url(jwk.y));
  } catch {
    return "VAPID_PRIVATE_KEY's x and y are not base64url.";
  }
  if (point.length !== 65) return "VAPID_PRIVATE_KEY's x and y are not 32 bytes each.";
  return {
    jwk: { kty: "EC", crv: "P-256", d: jwk.d, x: jwk.x, y: jwk.y },
    publicKey: base64url(point),
  };
}

/**
 * @param {Uint8Array<ArrayBuffer>} salt
 * @param {Uint8Array<ArrayBuffer>} ikm
 * @param {Uint8Array<ArrayBuffer>} info
 * @param {number} bytes
 */
async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8),
  );
}

/**
 * RFC 8291: the aes128gcm body for one subscription, a single record. `fixed` pins the sender's ECDH key and salt, for
 * a test that checks the RFC's worked example.
 * @param {import("./web-push.d.mts").PushSubscriptionKeys} sub
 * @param {Uint8Array} plaintext
 * @param {{ privateJwk?: JsonWebKey, salt?: Uint8Array<ArrayBuffer> }} [fixed]
 * @returns {Promise<Uint8Array<ArrayBuffer>>}
 */
export async function encryptPayload(sub, plaintext, fixed = {}) {
  const uaPublic = fromBase64url(sub.p256dh);
  const authSecret = fromBase64url(sub.auth);
  const ecdh = { name: "ECDH", namedCurve: "P-256" };
  /** @type {CryptoKey} */
  let asPrivate;
  /** @type {Uint8Array<ArrayBuffer>} */
  let asPublic;
  if (fixed.privateJwk) {
    asPrivate = await crypto.subtle.importKey("jwk", fixed.privateJwk, ecdh, false, ["deriveBits"]);
    asPublic = concatBytes(
      new Uint8Array([4]),
      fromBase64url(fixed.privateJwk.x ?? ""),
      fromBase64url(fixed.privateJwk.y ?? ""),
    );
  } else {
    const pair = /** @type {CryptoKeyPair} */ (
      await crypto.subtle.generateKey(ecdh, true, ["deriveBits"])
    );
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array(
      /** @type {ArrayBuffer} */ (await crypto.subtle.exportKey("raw", pair.publicKey)),
    );
  }
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, ecdh, false, []);
  // The standard member is `public`; workers-types spells it `$public` only because the
  // word is reserved in its generator, and workerd reads `public`.
  const derive = /** @type {SubtleCryptoDeriveKeyAlgorithm} */ (
    /** @type {unknown} */ ({ name: "ECDH", public: uaKey })
  );
  const shared = new Uint8Array(await crypto.subtle.deriveBits(derive, asPrivate, 256));
  const ikm = await hkdf(
    authSecret,
    shared,
    concatBytes(utf8("WebPush: info\0"), uaPublic, asPublic),
    32,
  );
  const salt = fixed.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);
  // One record, so the delimiter is 2 (the last record) and no padding follows it.
  if (plaintext.length + 1 + 16 > RECORD_SIZE)
    throw new Error(
      `a push payload of ${plaintext.length} bytes does not fit one ${RECORD_SIZE}-byte record`,
    );
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      key,
      concatBytes(plaintext, new Uint8Array([2])),
    ),
  );
  const header = new Uint8Array(16 + 4 + 1);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  return concatBytes(header, asPublic, sealed);
}

/**
 * RFC 8292: the Authorization header's JWT for one push service origin, signed through ./jwt.
 * @param {import("./web-push.d.mts").VapidKey} vapid
 * @param {string} audience the push service's origin
 * @param {string} subject a mailto: or https: contact
 * @param {Date} now
 */
export function vapidJwt(vapid, audience, subject, now) {
  return signJwt({
    alg: "ES256",
    key: vapid.jwk,
    header: { typ: "JWT" },
    claims: {
      aud: audience,
      exp: Math.floor(now.getTime() / 1000) + JWT_LIFETIME_SECONDS,
      sub: subject,
    },
  });
}

/** Encrypt and send one payload to one subscription. Never throws on a push service's
 *  answer; a network error is returned as status 0.
 * @param {import("./web-push.d.mts").VapidKey} vapid
 * @param {string} subject
 * @param {import("./web-push.d.mts").PushSubscriptionKeys} sub
 * @param {unknown} payload
 * @param {Date} now
 * @param {typeof fetch} [fetcher] default ./http timedFetch, so a push service that stalls cannot hold the cron open
 * @returns {Promise<import("./web-push.d.mts").PushSent>}
 */
export async function sendPush(vapid, subject, sub, payload, now, fetcher = timedFetch) {
  const problem = subscriptionProblem(sub);
  if (problem) return { status: 0, gone: true };
  const body = await encryptPayload(sub, utf8(JSON.stringify(payload)));
  const jwt = await vapidJwt(vapid, new URL(sub.endpoint).origin, subject, now);
  try {
    const res = await fetcher(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(TTL_SECONDS),
        Urgency: "high",
      },
      body,
    });
    await res.body?.cancel();
    return { status: res.status, gone: res.status === 404 || res.status === 410 };
  } catch {
    return { status: 0, gone: false };
  }
}
