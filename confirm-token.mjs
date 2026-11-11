/**
 * The confirmation token behind every preview-then-perform step (an admin's role change, an MCP tool that overwrites,
 * a namespace delete, a Portal control): a preview mints a token bound to exactly what it showed, and the perform
 * redeems it. Four sites each built one (the 2026-11-11 shared-code audit, item 41b); this is the one, on
 * ./signed-token, so a key rotates the same way as an emailed link's.
 *
 * - The claims are signed, not stored: any JSON object (who acts, on what, the arguments, a fingerprint of the plan).
 *   They are readable by whoever holds the token, so they carry ids and never a secret.
 * - `expect` names the claims the perform must match; each is compared as canonical JSON (keys sorted), so the same
 *   arguments always match whatever order they were written in.
 * - With `kv`, a token is spent on its first redeem (its one-time `jti` is written with a TTL past its expiry), so a
 *   confirmation is used once, by whichever surface took it. KV is eventually consistent across locations, so this
 *   stops a replay, not two redeems in the same second from two continents; a perform that must be exactly once also
 *   checks its own row (a compare-and-set on the value the preview saw).
 *
 * Refusals: 403 for a token that is malformed, does not verify or was issued for another action or caller; 409 for one
 * already spent; 410 for one that expired. Each reason ends "preview again".
 */

import { readSignedToken, signToken } from "./signed-token.mjs";
import { toHex } from "./encoding.mjs";

/** How long a preview stays performable by default: ten minutes. */
export const CONFIRM_TTL_SECONDS = 600;

/** KV's own expiry floor. */
const KV_TTL_FLOOR = 60;

/**
 * JSON with every object's keys sorted and undefined members left out.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(/** @type {Record<string, unknown>} */ (value))
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Mint a token for exactly these claims.
 * @param {{ keys: readonly (string | null | undefined)[], claims: Record<string, unknown>, ttlSeconds?: number,
 *   now?: number }} options hex keys, newest first (./signed-token)
 * @returns {Promise<{ token: string, expiresAt: string }>}
 */
export async function mintConfirm({
  keys,
  claims,
  ttlSeconds = CONFIRM_TTL_SECONDS,
  now = Date.now(),
}) {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0)
    throw new RangeError(`ttlSeconds must be a positive whole number, got ${ttlSeconds}`);
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const jti = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const token = await signToken(keys, { c: claims, exp, jti });
  return { token, expiresAt: new Date(exp * 1000).toISOString() };
}

/**
 * @typedef {{ ok: true, claims: Record<string, unknown> }
 *   | { ok: false, status: 403 | 409 | 410, reason: string }} Redeemed
 */

/**
 * Check a token against what the perform is about to do, and spend it when `kv` is given.
 * @param {{ keys: readonly (string | null | undefined)[], token: string, expect?: Record<string, unknown>,
 *   kv?: { get(key: string): Promise<string | null>, put(key: string, value: string,
 *   options?: { expirationTtl?: number }): Promise<void> }, prefix?: string, now?: number }} options
 * @returns {Promise<Redeemed>}
 */
export async function redeemConfirm({
  keys,
  token,
  expect = {},
  kv,
  prefix = "confirm-jti:",
  now = Date.now(),
}) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))
    return refuse(403, "the confirmation token is malformed: preview again.");
  const payload = await readSignedToken(keys, token);
  if (!payload) return refuse(403, "the confirmation token does not verify: preview again.");
  const { c: claims, exp, jti } = payload;
  if (
    !claims ||
    typeof claims !== "object" ||
    Array.isArray(claims) ||
    typeof exp !== "number" ||
    typeof jti !== "string" ||
    !/^[0-9a-f]{32}$/.test(jti)
  )
    return refuse(
      403,
      "the confirmation token verifies but is not one this Worker signs: preview again.",
    );
  const signed = /** @type {Record<string, unknown>} */ (claims);
  for (const [name, value] of Object.entries(expect)) {
    if (canonicalJson(signed[name]) !== canonicalJson(value))
      return refuse(
        403,
        `the confirmation was issued for another ${name}: preview again with the arguments you mean.`,
      );
  }
  if (exp * 1000 <= now) return refuse(410, "the confirmation expired: preview again.");
  if (kv) {
    const key = `${prefix}${jti}`;
    if ((await kv.get(key)) !== null)
      return refuse(409, "the confirmation was already used: preview again.");
    const left = Math.ceil(exp - now / 1000);
    await kv.put(key, "1", { expirationTtl: Math.max(KV_TTL_FLOOR, left + KV_TTL_FLOOR) });
  }
  return { ok: true, claims: signed };
}

/**
 * @param {403 | 409 | 410} status
 * @param {string} reason
 * @returns {Redeemed}
 */
function refuse(status, reason) {
  return { ok: false, status, reason };
}
