/**
 * A keyring from the active key, its id and the keys that only open.
 * @param {{ key: string, id?: string, old?: { id: string, key: string }[], label?: string }} options
 * @returns {Keyring}
 */
export function keyring({ key, id, old, label }: {
    key: string;
    id?: string;
    old?: {
        id: string;
        key: string;
    }[];
    label?: string;
}): Keyring;
/**
 * The keyring from a Worker's env: the active key, its id (default "k1") and decrypt-only old keys as "id:key,id:key".
 * Foxhound's names are the defaults.
 * @param {object} env
 * @param {{ key?: string, id?: string, old?: string, defaultId?: string }} [names]
 */
export function keyringFromEnv(env: object, names?: {
    key?: string;
    id?: string;
    old?: string;
    defaultId?: string;
}): Keyring;
/**
 * Seal text under the active key.
 * @param {Keyring} ring
 * @param {string} text
 */
export function seal(ring: Keyring, text: string): Promise<string>;
/**
 * The key id a sealed value names, or null when it is not a sealed value.
 * @param {string} sealed
 */
export function keyIdOf(sealed: string): string | null;
/**
 * Open a sealed value. Throws on a malformed value, a key id the ring lacks, or a failed tag.
 * @param {Keyring} ring
 * @param {string} sealed
 */
export function open(ring: Keyring, sealed: string): Promise<string>;
/**
 * Reseal a value onto the active key, or null when it is already there.
 * @param {Keyring} ring
 * @param {string} sealed
 */
export function reseal(ring: Keyring, sealed: string): Promise<string | null>;
/**
 * The active key's id and every key that opens, by id.
 */
export type Keyring = {
    activeId: string;
    byId: Map<string, Uint8Array<ArrayBuffer>>;
};
