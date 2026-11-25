/**
 * The signing key the secret stands for: an Ed25519 key whose seed is HKDF-SHA-256 of the secret, its public key
 * (base64url, raw) and its id (the first 16 hex of the public key's SHA-256). The same secret always gives the same key.
 * @param {string | undefined} secret
 * @returns {Promise<ChainKey>}
 */
export function auditChainKey(secret: string | undefined): Promise<ChainKey>;
/**
 * A row's link in the chain: SHA-256 of the previous hash and the row's stored values, with its key_id when it is signed.
 * @param {string | null} previous
 * @param {Record<string, unknown>} row
 */
export function rowHash(previous: string | null, row: Record<string, unknown>): Promise<string>;
/**
 * The keys trusted for `rows`: each given public key, then each `fromPublicKey` a trusted key's `chain-key` row names.
 * @param {readonly string[]} publicKeys
 * @param {Array<Record<string, unknown>>} rows
 */
export function trust(publicKeys: readonly string[], rows: Array<Record<string, unknown>>): Promise<Map<string, {
    publicKey: string;
    key: CryptoKey;
}>>;
/**
 * Checks the chain over rows in `seq` order: every hash, then, with `keys` (trusted public keys, base64url), every
 * signature. Rows from before the hash column are skipped. `previous` is the hash of the row before the first given
 * one (a copy's `previous`). The key changes only at a `chain-key` row whose `from` is the key before; an unsigned row
 * passes only before a `chain-key` row with `from: null`. Without keys only hashes are checked, and `signed` is 0.
 * @param {Array<Record<string, unknown>>} rows
 * @param {{ keys?: readonly string[], previous?: string | null }} [options]
 * @returns {Promise<ChainCheck>}
 */
export function verifyAuditChain(rows: Array<Record<string, unknown>>, { keys, previous }?: {
    keys?: readonly string[];
    previous?: string | null;
}): Promise<ChainCheck>;
export const ANCHOR: "chain-key";
export const HASHED: string[];
export type ChainKey = {
    id: string;
    publicKey: string;
    sign(hash: string): Promise<string>;
};
/**
 * What `verifyAuditChain` finds: every row checked, or the first that fails and why.
 */
export type ChainCheck = {
    ok: true;
    hashed: number;
    signed: number;
} | {
    ok: false;
    seq: unknown;
    reason: "hash" | "unsigned" | "unknown key" | "signature" | "key change";
};
