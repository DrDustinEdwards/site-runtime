// A Cache over a Map, keyed by the request's URL or the string it is given.

/** @param {Map<string, Response>} [store] */
export function mapCache(store = new Map()) {
  const key = (/** @type {Request | string} */ k) => (typeof k === "string" ? k : k.url);
  return /** @type {Cache} */ (
    /** @type {unknown} */ ({
      match: async (/** @type {Request | string} */ k) => store.get(key(k))?.clone(),
      put: async (/** @type {Request | string} */ k, /** @type {Response} */ r) =>
        void store.set(key(k), r),
    })
  );
}
