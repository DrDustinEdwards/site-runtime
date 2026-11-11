import assert from "node:assert/strict";
import { test } from "node:test";
import { kvCached } from "../kv-cache.mjs";

function kv({ broken = false } = {}) {
  /** @type {Map<string, { value: string, ttl: number }>} */
  const store = new Map();
  return {
    store,
    async get(/** @type {string} */ key) {
      if (broken) throw new Error("kv down");
      const hit = store.get(key);
      return hit ? JSON.parse(hit.value) : null;
    },
    async put(/** @type {string} */ key, /** @type {string} */ value, /** @type {any} */ o) {
      if (broken) throw new Error("kv down");
      store.set(key, { value, ttl: o.expirationTtl });
    },
  };
}

test("a miss reads and keeps it at KV's 60 s floor; a hit, a refused value and a broken KV", async () => {
  const ns = kv();
  let reads = 0;
  const read = async () => ({ n: ++reads });
  assert.deepEqual(await kvCached(ns, "k", { ttl: 5 }, read), { n: 1 });
  assert.equal(ns.store.get("k")?.ttl, 60);
  assert.deepEqual(await kvCached(ns, "k", { ttl: 5 }, read), { n: 1 });
  // A kept value of the wrong shape is a miss; a value `keep` refuses is answered and not kept.
  const shaped = (/** @type {any} */ v) => typeof v?.m === "number";
  assert.deepEqual(await kvCached(ns, "k", { ttl: 5, valid: shaped, keep: () => false }, read), {
    n: 2,
  });
  assert.equal(ns.store.get("k")?.value, '{"n":1}');
  // A KV that throws on both sides still answers.
  assert.deepEqual(await kvCached(kv({ broken: true }), "k", { ttl: 5 }, read), { n: 3 });
  // A read that throws keeps nothing and throws on.
  await assert.rejects(
    kvCached(ns, "x", { ttl: 5 }, async () => Promise.reject(new Error("db down"))),
  );
  assert.equal(ns.store.has("x"), false);
});
