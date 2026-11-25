/**
 * @param {{ keys: readonly (string | null | undefined)[], claims: Record<string, unknown>, ttlSeconds?: number,
 *   now?: number }} options hex keys, newest first (./signed-token)
 * @returns {Promise<{ token: string, expiresAt: string }>}
 */
export function mintConfirm({ keys, claims, ttlSeconds, now, }: {
    keys: readonly (string | null | undefined)[];
    claims: Record<string, unknown>;
    ttlSeconds?: number;
    now?: number;
}): Promise<{
    token: string;
    expiresAt: string;
}>;
/**
 * @typedef {{ ok: true, claims: Record<string, unknown> }
 *   | { ok: false, status: 403 | 409 | 410, reason: string }} Redeemed
 */
/**
 * Check a token against what the perform is about to do, and spend it when `kv` is given.
 * @param {{ keys: readonly (string | null | undefined)[], token: string, expect: Record<string, unknown>,
 *   kv?: { get(key: string): Promise<string | null>, put(key: string, value: string,
 *   options?: { expirationTtl?: number }): Promise<void> }, prefix?: string, now?: number }} options
 * @returns {Promise<Redeemed>}
 */
export function redeemConfirm({ keys, token, expect, kv, prefix, now, }: {
    keys: readonly (string | null | undefined)[];
    token: string;
    expect: Record<string, unknown>;
    kv?: {
        get(key: string): Promise<string | null>;
        put(key: string, value: string, options?: {
            expirationTtl?: number;
        }): Promise<void>;
    };
    prefix?: string;
    now?: number;
}): Promise<Redeemed>;
/** How long a preview stays performable by default: ten minutes. */
export const CONFIRM_TTL_SECONDS: 600;
export type Redeemed = {
    ok: true;
    claims: Record<string, unknown>;
} | {
    ok: false;
    status: 403 | 409 | 410;
    reason: string;
};
