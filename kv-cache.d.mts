/** The part of a KV namespace kvCached uses. */
export interface KvLike {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
}

export interface KvCacheOptions<T> {
  /** Seconds an entry is kept; under KV's 60 is raised to 60. */
  ttl: number;
  /** True for a kept value that may be served (a shape check); default anything but null. */
  valid?: (value: unknown) => boolean;
  /** False keeps a fresh value out of KV (a failed or empty answer); default keeps everything. */
  keep?: (value: T) => boolean;
  /** True skips the lookup and always reads, then keeps the new value (a "fresh" request); default false. */
  refresh?: boolean;
}

/** KV's shortest expirationTtl, in seconds. */
export const KV_MIN_TTL: 60;

/** The kept value for `key`, or what `read` returns, kept for `ttl` seconds. A KV fault never fails the read. */
export function kvCached<T>(
  kv: KvLike | null | undefined,
  key: string,
  options: KvCacheOptions<T>,
  read: () => Promise<T>,
): Promise<T>;
