/** The tool-call log's hash chain: the signing key, a row's link, and verification (see audit-log.mjs). */

import { base64url, fromBase64url, sha256Hex } from "./encoding.mjs";

/** @import { ChainKey } from "./audit-log.mjs" */

/** @import { ChainCheck } from "./audit-log.mjs" */

/** The shortest AUDIT_SIGNING_KEY accepted, as for ADMIN_IDLE_SECRET: worker-deploy mints 43 characters. */
const KEY_CHARS = 32;
export const ANCHOR = "chain-key";

// Hashed in order; client_name (when set) and key_id (when signed) follow, so older rows keep their hash.
export const HASHED = [
  "at",
  "call_id",
  "phase",
  "caller",
  "tool",
  "args",
  "result",
  "server",
  "version",
  "client_id",
  "correlation_id",
];

// PKCS #8 for an Ed25519 private key is this fixed prefix and the 32-byte seed (RFC 8410, section 7).
const PKCS8_ED25519 = /* @__PURE__ */ Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);
const KDF_INFO = "site-runtime audit-log chain key v1";

/** @type {Map<string, Promise<ChainKey>>} */
const derived = new Map();

/**
 * The signing key the secret stands for: an Ed25519 key whose seed is HKDF-SHA-256 of the secret, its public key
 * (base64url, raw) and its id (the first 16 hex of the public key's SHA-256). The same secret always gives the same key.
 * @param {string | undefined} secret
 * @returns {Promise<ChainKey>}
 */
export function auditChainKey(secret) {
  if (typeof secret !== "string" || secret.length < KEY_CHARS) {
    return Promise.reject(
      new Error(
        `AUDIT_SIGNING_KEY is not bound or is shorter than ${KEY_CHARS} characters, so the tool-call log writes nothing`,
      ),
    );
  }
  let key = derived.get(secret);
  if (!key) {
    key = (async () => {
      const subtle = crypto.subtle;
      const ikm = await subtle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, [
        "deriveBits",
      ]);
      const seed = new Uint8Array(
        await subtle.deriveBits(
          {
            name: "HKDF",
            hash: "SHA-256",
            salt: new Uint8Array(0),
            info: new TextEncoder().encode(KDF_INFO),
          },
          ikm,
          256,
        ),
      );
      const pkcs8 = new Uint8Array(PKCS8_ED25519.length + seed.length);
      pkcs8.set(PKCS8_ED25519);
      pkcs8.set(seed, PKCS8_ED25519.length);
      const signer = await subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, true, ["sign"]);
      const publicKey = /** @type {string} */ (
        /** @type {JsonWebKey} */ (await subtle.exportKey("jwk", signer)).x
      );
      return {
        id: await keyId(publicKey),
        publicKey,
        sign: async (hash) =>
          base64url(await subtle.sign("Ed25519", signer, new TextEncoder().encode(hash))),
      };
    })();
    derived.set(secret, key);
    key.catch(() => derived.delete(secret));
  }
  return key;
}

/** @param {string} publicKey base64url raw Ed25519 public key */
async function keyId(publicKey) {
  return (await sha256Hex(fromBase64url(publicKey))).slice(0, 16);
}

/**
 * A row's link in the chain: SHA-256 of the previous hash and the row's stored values, with its key_id when it is signed.
 * @param {string | null} previous
 * @param {Record<string, unknown>} row
 */
export function rowHash(previous, row) {
  const values = HASHED.map((name) => row[name] ?? null);
  if (row.client_name != null) values.push(row.client_name);
  if (row.key_id != null) values.push(row.key_id);
  return sha256Hex(`${previous ?? ""}\n${JSON.stringify(values)}`);
}

/** @param {unknown} args */
function anchorArgs(args) {
  try {
    const parsed = JSON.parse(String(args));
    return parsed && typeof parsed === "object"
      ? /** @type {Record<string, unknown>} */ (parsed)
      : {};
  } catch {
    return {};
  }
}

/** @param {string} publicKey */
function verifier(publicKey) {
  return crypto.subtle.importKey("raw", fromBase64url(publicKey), { name: "Ed25519" }, false, [
    "verify",
  ]);
}

/**
 * @param {CryptoKey} key
 * @param {Record<string, unknown>} row
 */
async function signedBy(key, row) {
  try {
    return await crypto.subtle.verify(
      "Ed25519",
      key,
      fromBase64url(String(row.sig ?? "")),
      new TextEncoder().encode(String(row.hash)),
    );
  } catch {
    return false;
  }
}

/**
 * The keys trusted for `rows`: each given public key, then each `fromPublicKey` a trusted key's `chain-key` row names.
 * @param {readonly string[]} publicKeys
 * @param {Array<Record<string, unknown>>} rows
 */
export async function trust(publicKeys, rows) {
  /** @type {Map<string, { publicKey: string, key: CryptoKey }>} */
  const trusted = new Map();
  for (const publicKey of publicKeys)
    trusted.set(await keyId(publicKey), { publicKey, key: await verifier(publicKey) });
  const anchors = rows.filter((row) => row.phase === ANCHOR && row.key_id != null);
  for (let grew = trusted.size > 0; grew;) {
    grew = false;
    for (const row of anchors) {
      const args = anchorArgs(row.args);
      const signer = trusted.get(String(row.key_id));
      if (
        !signer ||
        typeof args.fromPublicKey !== "string" ||
        typeof args.from !== "string" ||
        trusted.has(args.from)
      )
        continue;
      if (!(await signedBy(signer.key, row)) || (await keyId(args.fromPublicKey)) !== args.from)
        continue;
      trusted.set(args.from, {
        publicKey: args.fromPublicKey,
        key: await verifier(args.fromPublicKey),
      });
      grew = true;
    }
  }
  return trusted;
}

/**
 * Checks the chain over rows in `seq` order: every hash, then, with `keys` (trusted public keys, base64url), every
 * signature. Rows from before the hash column are skipped. `previous` is the hash of the row before the first given
 * one (a copy's `previous`). The key changes only at a `chain-key` row whose `from` is the key before; an unsigned row
 * passes only before a `chain-key` row with `from: null`. Without keys only hashes are checked, and `signed` is 0.
 * @param {Array<Record<string, unknown>>} rows
 * @param {{ keys?: readonly string[], previous?: string | null }} [options]
 * @returns {Promise<ChainCheck>}
 */
export async function verifyAuditChain(rows, { keys = [], previous = null } = {}) {
  const trusted = await trust(keys, rows);
  const lastUnsignedAllowed = rows.findIndex(
    (row) => row.phase === ANCHOR && row.key_id != null && anchorArgs(row.args).from === null,
  );
  const checkSignatures = keys.length > 0;
  /** @type {string | null} */
  let link = previous;
  /** @type {string | undefined} the key of the signed row before; undefined until one is seen */
  let lastKey;
  let unsignedBefore = false;
  let hashed = 0;
  let signed = 0;
  for (const [index, row] of rows.entries()) {
    if (row.hash == null && link === null) continue;
    if (row.hash !== (await rowHash(link, row))) return { ok: false, seq: row.seq, reason: "hash" };
    if (checkSignatures) {
      if (row.key_id == null) {
        if (lastKey !== undefined || !(index < lastUnsignedAllowed))
          return { ok: false, seq: row.seq, reason: "unsigned" };
        unsignedBefore = true;
      } else {
        const id = String(row.key_id);
        const key = trusted.get(id);
        if (!key) return { ok: false, seq: row.seq, reason: "unknown key" };
        if (!(await signedBy(key.key, row)))
          return { ok: false, seq: row.seq, reason: "signature" };
        const args = row.phase === ANCHOR ? anchorArgs(row.args) : null;
        if (args && args.to !== id) return { ok: false, seq: row.seq, reason: "key change" };
        const before = lastKey ?? (unsignedBefore ? null : undefined);
        // A slice that starts on a signed row may start with any trusted key; after that, only an anchor changes it.
        if (before !== undefined && before !== id && args?.from !== before)
          return { ok: false, seq: row.seq, reason: "key change" };
        lastKey = id;
        signed++;
      }
    }
    link = /** @type {string} */ (row.hash);
    hashed++;
  }
  return { ok: true, hashed, signed };
}
