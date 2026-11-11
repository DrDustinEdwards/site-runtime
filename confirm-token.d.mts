/** The confirmation token behind every preview-then-perform step (confirm-token.mjs), on ./signed-token. */

export const CONFIRM_TTL_SECONDS: number;

/** JSON with every object's keys sorted and undefined members left out. */
export function canonicalJson(value: unknown): string;

/** Mint a token for exactly these claims (hex keys, newest first). */
export function mintConfirm(options: {
  keys: readonly (string | null | undefined)[];
  claims: Record<string, unknown>;
  ttlSeconds?: number;
  now?: number;
}): Promise<{ token: string; expiresAt: string }>;

export type Redeemed =
  | { ok: true; claims: Record<string, unknown> }
  | { ok: false; status: 403 | 409 | 410; reason: string };

/** Check a token against the claims the perform must match; spend it once when `kv` is given. */
export function redeemConfirm(options: {
  keys: readonly (string | null | undefined)[];
  token: string;
  expect?: Record<string, unknown>;
  kv?: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  };
  prefix?: string;
  now?: number;
}): Promise<Redeemed>;
