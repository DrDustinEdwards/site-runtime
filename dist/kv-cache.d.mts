/**
 * @template T
 * @param {KvLike | null | undefined} kv the namespace; none reads straight through
 * @param {string} key
 * @param {KvCacheOptions<T>} options
 * @param {() => Promise<T>} read
 * @returns {Promise<T>}
 */
export function kvCached<T>(kv: KvLike | null | undefined, key: string, { ttl, valid, keep, refresh }: KvCacheOptions<T>, read: () => Promise<T>): Promise<T>;
/**
 * The part of a KV namespace kvCached uses.
 * @typedef {{ get(key: string, type: "json"): Promise<unknown>; put(key: string, value: string, options: { expirationTtl: number }): Promise<void>; }} KvLike
 */
/**
 * @template T
 * @typedef {object} KvCacheOptions
 * @property {number} ttl Seconds an entry is kept; under KV's 60 is raised to 60.
 * @property {(value: unknown) => boolean} [valid] True for a kept value that may be served (a shape check); default anything but null.
 * @property {(value: T) => boolean} [keep] False keeps a fresh value out of KV (a failed or empty answer); default keeps everything.
 * @property {boolean} [refresh] True skips the lookup and always reads, then keeps the new value (a "fresh" request); default false.
 */
/** KV's shortest expirationTtl, in seconds. */
export const KV_MIN_TTL: 60;
/**
 * The part of a KV namespace kvCached uses.
 */
export type KvLike = {
    get(key: string, type: "json"): Promise<unknown>;
    put(key: string, value: string, options: {
        expirationTtl: number;
    }): Promise<void>;
};
export type KvCacheOptions<T> = {
    /**
     * Seconds an entry is kept; under KV's 60 is raised to 60.
     */
    ttl: number;
    /**
     * True for a kept value that may be served (a shape check); default anything but null.
     */
    valid?: ((value: unknown) => boolean) | undefined;
    /**
     * False keeps a fresh value out of KV (a failed or empty answer); default keeps everything.
     */
    keep?: ((value: T) => boolean) | undefined;
    /**
     * True skips the lookup and always reads, then keeps the new value (a "fresh" request); default false.
     */
    refresh?: boolean | undefined;
};
