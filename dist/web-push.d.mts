/** Why a subscription cannot be stored, or null. Checked at subscribe time, before any
 *  row is written, and again before each send.
 * @param {Partial<PushSubscriptionKeys>} sub
 * @returns {string | null}
 */
export function subscriptionProblem(sub: Partial<PushSubscriptionKeys>): string | null;
/**
 * The VAPID key from its secret, or why it cannot be used.
 * @param {string | undefined} secret
 * @returns {VapidKey | string}
 */
export function readVapidKey(secret: string | undefined): VapidKey | string;
/**
 * RFC 8291: the aes128gcm body for one subscription, a single record. `fixed` pins the sender's ECDH key and salt, for
 * a test that checks the RFC's worked example.
 * @param {PushSubscriptionKeys} sub
 * @param {Uint8Array} plaintext
 * @param {{ privateJwk?: JsonWebKey, salt?: Uint8Array<ArrayBuffer> }} [fixed]
 * @returns {Promise<Uint8Array<ArrayBuffer>>}
 */
export function encryptPayload(sub: PushSubscriptionKeys, plaintext: Uint8Array, fixed?: {
    privateJwk?: JsonWebKey;
    salt?: Uint8Array<ArrayBuffer>;
}): Promise<Uint8Array<ArrayBuffer>>;
/**
 * RFC 8292: the Authorization header's JWT for one push service origin, signed through ./jwt.
 * @param {VapidKey} vapid
 * @param {string} audience the push service's origin
 * @param {string} subject a mailto: or https: contact
 * @param {Date} now
 */
export function vapidJwt(vapid: VapidKey, audience: string, subject: string, now: Date): Promise<string>;
/** Encrypt and send one payload to one subscription. Never throws on a push service's
 *  answer; a network error is returned as status 0.
 * @param {VapidKey} vapid
 * @param {string} subject
 * @param {PushSubscriptionKeys} sub
 * @param {unknown} payload
 * @param {Date} now
 * @param {typeof fetch} [fetcher] default ./http timedFetch, so a push service that stalls cannot hold the cron open
 * @returns {Promise<PushSent>}
 */
export function sendPush(vapid: VapidKey, subject: string, sub: PushSubscriptionKeys, payload: unknown, now: Date, fetcher?: typeof fetch): Promise<PushSent>;
/**
 * Web Push from a Worker (web-push.mjs): RFC 8291 aes128gcm encryption and RFC 8292 VAPID, on WebCrypto.
 */
export type PushSubscriptionKeys = {
    endpoint: string;
    p256dh: string;
    auth: string;
};
export type VapidKey = {
    jwk: JsonWebKey;
    /**
     * The public key, 65 bytes uncompressed, base64url: what the browser subscribes with.
     */
    publicKey: string;
};
export type PushSent = {
    status: number;
    /**
     * The push service says the subscription is gone (404 or 410): stop sending to it.
     */
    gone: boolean;
};
