/** A secret sealed at rest with AES-256-GCM under a rotating keyring (secret-box.mjs): `v1:<keyId>:<ivHex>:<cipherHex>`. */

/** The active key's id and every key that opens, by id. */
export interface Keyring {
  activeId: string;
  byId: Map<string, Uint8Array<ArrayBuffer>>;
}
/** A keyring from the active key (64 hex digits or base64 of 32 bytes), its id (default "k1") and decrypt-only old keys. */
export function keyring(options: {
  key: string;
  id?: string;
  old?: { id: string; key: string }[];
  label?: string;
}): Keyring;
/** The keyring from env: ENCRYPTION_KEY, ENCRYPTION_KEY_ID and ENCRYPTION_KEYS_OLD ("id:key,id:key") unless renamed. */
export function keyringFromEnv(
  env: object,
  names?: { key?: string; id?: string; old?: string; defaultId?: string },
): Keyring;
/** Seal text under the active key. */
export function seal(ring: Keyring, text: string): Promise<string>;
/** The key id a sealed value names, or null when it is not one. */
export function keyIdOf(sealed: string): string | null;
/** Open a sealed value; throws on a malformed value, an unknown key id or a failed tag. */
export function open(ring: Keyring, sealed: string): Promise<string>;
/** Reseal onto the active key, or null when the value is already on it. */
export function reseal(ring: Keyring, sealed: string): Promise<string | null>;
