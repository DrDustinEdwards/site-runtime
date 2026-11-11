/** Web Push from a Worker (web-push.mjs): RFC 8291 aes128gcm encryption and RFC 8292 VAPID, on WebCrypto. */

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}
export interface VapidKey {
  jwk: JsonWebKey;
  /** The public key, 65 bytes uncompressed, base64url: what the browser subscribes with. */
  publicKey: string;
}
export interface PushSent {
  status: number;
  /** The push service says the subscription is gone (404 or 410): stop sending to it. */
  gone: boolean;
}
/** Why a subscription cannot be stored or sent to (not https, not a known push service, bad keys), or null. */
export function subscriptionProblem(sub: Partial<PushSubscriptionKeys>): string | null;
/** The VAPID key from its secret (a P-256 private JWK as JSON), or why it cannot be used. */
export function readVapidKey(secret: string | undefined): VapidKey | string;
/** The aes128gcm body for one subscription, one record; `fixed` pins the sender's key and salt for a test. */
export function encryptPayload(
  sub: PushSubscriptionKeys,
  plaintext: Uint8Array,
  fixed?: { privateJwk?: JsonWebKey; salt?: Uint8Array<ArrayBuffer> },
): Promise<Uint8Array<ArrayBuffer>>;
/** The VAPID JWT for one push service origin, twelve hours long. */
export function vapidJwt(vapid: VapidKey, audience: string, subject: string, now: Date): Promise<string>;
/** Encrypt and send one payload; never throws on the push service's answer (a network error is status 0). */
export function sendPush(
  vapid: VapidKey,
  subject: string,
  sub: PushSubscriptionKeys,
  payload: unknown,
  now: Date,
  fetcher?: typeof fetch,
): Promise<PushSent>;
