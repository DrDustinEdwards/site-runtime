/**
 * A secret kept at rest, sealed with AES-256-GCM under a keyring that rotates: the active key seals, older keys only
 * open. From Foxhound's Stripe token store (app/lib/stripe/encryption.ts), whose stored format this keeps bit for bit:
 * `v1:<keyId>:<ivHex>:<cipherHex>`, the cipher with GCM's 16-byte tag appended (WebCrypto's layout). The key id is what
 * makes rotation possible: a stored value names the key that sealed it.
 *
 * Rotation: move the active key into the old list under its id, set the new key and id, deploy, `reseal` every stored
 * value (it returns null for one already on the active key, so a sweep counts real work), then drop the old list.
 *
 * Every failure throws with a message that names the fix and never the plaintext: a key problem is something a person
 * must see, never a silent null.
 */

import { fromBase64, fromHex, toHex } from "./encoding.mjs";

const FORMAT = "v1";
const IV_BYTES = 12;

/**
 * The 32 bytes of a key written as 64 hex digits, or as base64 (Carrel's GOOGLE_TOKEN_KEY).
 * @param {string} text
 * @param {string} label
 */
function keyBytes(text, label) {
  const value = text.trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) return fromHex(value);
  /** @type {Uint8Array<ArrayBuffer> | null} */
  let bytes = null;
  try {
    bytes = fromBase64(value);
  } catch {
    bytes = null;
  }
  if (bytes?.length === 32) return bytes;
  throw new Error(`${label} must be 32 bytes, as 64 hex digits or base64, for AES-256-GCM`);
}

/**
 * A keyring from the active key, its id and the keys that only open.
 * @param {{ key: string, id?: string, old?: { id: string, key: string }[], label?: string }} options
 * @returns {import("./secret-box.d.mts").Keyring}
 */
export function keyring({ key, id = "k1", old = [], label = "the active key" }) {
  if (!key?.trim()) throw new Error(`${label} is not set`);
  const activeId = id.trim();
  if (!activeId) throw new Error(`${label}'s id is set but empty`);
  if (activeId.includes(":")) throw new Error(`${label}'s id must not contain ':'`);
  /** @type {Map<string, Uint8Array<ArrayBuffer>>} */
  const byId = new Map([[activeId, keyBytes(key, label)]]);
  for (const entry of old) {
    // The active id wins: an old key reusing it would shadow the sealing key.
    if (entry.id === activeId) throw new Error(`An old key reuses the active key id '${entry.id}'`);
    if (!entry.id || entry.id.includes(":"))
      throw new Error("An old key's id must be set and must not contain ':'");
    byId.set(entry.id, keyBytes(entry.key, `old key '${entry.id}'`));
  }
  return { activeId, byId };
}

/**
 * The keyring from a Worker's env: the active key, its id (default "k1") and decrypt-only old keys as "id:key,id:key".
 * Foxhound's names are the defaults.
 * @param {Record<string, unknown>} env
 * @param {{ key?: string, id?: string, old?: string, defaultId?: string }} [names]
 */
export function keyringFromEnv(env, names = {}) {
  const keyName = names.key ?? "ENCRYPTION_KEY";
  const idName = names.id ?? "ENCRYPTION_KEY_ID";
  const oldName = names.old ?? "ENCRYPTION_KEYS_OLD";
  const text = (/** @type {string} */ name) =>
    typeof env[name] === "string" ? /** @type {string} */ (env[name]) : undefined;
  /** @type {{ id: string, key: string }[]} */
  const old = [];
  for (const entry of (text(oldName) ?? "").split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf(":");
    if (sep <= 0) throw new Error(`${oldName} entries must be 'keyId:key'`);
    old.push({ id: trimmed.slice(0, sep).trim(), key: trimmed.slice(sep + 1).trim() });
  }
  return keyring({
    key: text(keyName) ?? "",
    id: text(idName) ?? names.defaultId ?? "k1",
    old,
    label: keyName,
  });
}

/** @param {Uint8Array<ArrayBuffer>} bytes */
function importKey(bytes) {
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/**
 * Seal text under the active key.
 * @param {import("./secret-box.d.mts").Keyring} ring
 * @param {string} text
 */
export async function seal(ring, text) {
  const key = await importKey(
    /** @type {Uint8Array<ArrayBuffer>} */ (ring.byId.get(ring.activeId)),
  );
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(text),
  );
  return `${FORMAT}:${ring.activeId}:${toHex(iv)}:${toHex(cipher)}`;
}

/**
 * The key id a sealed value names, or null when it is not a sealed value.
 * @param {string} sealed
 */
export function keyIdOf(sealed) {
  const parts = sealed.split(":");
  return parts.length === 4 && parts[0] === FORMAT ? parts[1] : null;
}

/**
 * Open a sealed value. Throws on a malformed value, a key id the ring lacks, or a failed tag.
 * @param {import("./secret-box.d.mts").Keyring} ring
 * @param {string} sealed
 */
export async function open(ring, sealed) {
  const parts = sealed.split(":");
  if (parts.length !== 4 || parts[0] !== FORMAT) {
    throw new Error("Malformed sealed value (expected v1:keyId:ivHex:cipherHex)");
  }
  const [, id, ivHex, cipherHex] = parts;
  const bytes = ring.byId.get(id);
  if (!bytes) {
    throw new Error(
      `No key for id '${id}'. Keys available: ${[...ring.byId.keys()].join(", ")}. Add it to the old keys (decrypt-only) or make it the active key.`,
    );
  }
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromHex(ivHex) },
    await importKey(bytes),
    fromHex(cipherHex),
  );
  return new TextDecoder().decode(plain);
}

/**
 * Reseal a value onto the active key, or null when it is already there.
 * @param {import("./secret-box.d.mts").Keyring} ring
 * @param {string} sealed
 */
export async function reseal(ring, sealed) {
  if (keyIdOf(sealed) === ring.activeId) return null;
  return seal(ring, await open(ring, sealed));
}
