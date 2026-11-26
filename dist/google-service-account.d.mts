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
export function parseServiceAccountKey(raw: string | null | undefined, name: string): {
    ok: true;
    key: ServiceAccountKey;
} | {
    ok: false;
    state: "not-connected" | "misconfigured";
    detail: string;
};
/** Forget every cached token (tests, or a key that was just rotated). */
export function clearServiceAccountTokens(): void;
/**
 * An access token for `scopes`, reused until five minutes before it expires. A refusal throws with Google's error
 * (invalid_grant is a deleted, disabled or expired key).
 * @param {ServiceAccountKey} key
 * @param {string[]} scopes
 * @param {{ fetcher?: typeof fetch; now?: number }} [options]
 * @returns {Promise<string>}
 */
export function serviceAccountToken(key: ServiceAccountKey, scopes: string[], options?: {
    fetcher?: typeof fetch;
    now?: number;
}): Promise<string>;
export const GOOGLE_TOKEN_URL: "https://oauth2.googleapis.com/token";
export type ServiceAccountKey = {
    clientEmail: string;
    privateKey: string;
    privateKeyId: string | null;
    tokenUri: string;
};
