// The constant-time compare, on both paths: the XOR fallback Node takes, and crypto.subtle.timingSafeEqual as workerd
// has it (stubbed here, since Node has none). PLANT tests fail if the guard they name is removed.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { safeEqual } from "../compare.mjs";

const subtle = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (crypto.subtle));

/** @type {Uint8Array[][]} */
const nativeCalls = [];
function installNative() {
  Object.defineProperty(crypto.subtle, "timingSafeEqual", {
    configurable: true,
    value: (/** @type {Uint8Array} */ x, /** @type {Uint8Array} */ y) => {
      if (x.byteLength !== y.byteLength) throw new TypeError("lengths differ"); // workerd throws, as node:crypto does
      nativeCalls.push([x, y]);
      return Buffer.from(x).equals(Buffer.from(y));
    },
  });
}
function removeNative() {
  delete subtle.timingSafeEqual;
}

/** The cases both paths must answer the same way. */
function sharedCases() {
  test("the same string is equal; any other is not", async () => {
    assert.equal(await safeEqual("s3cret-token", "s3cret-token"), true);
    assert.equal(await safeEqual("s3cret-token", "s3cret-tokem"), false);
    assert.equal(await safeEqual("s3cret-token", "S3cret-token"), false);
    assert.equal(await safeEqual("é", "é"), false); // composed and decomposed: different bytes
    assert.equal(await safeEqual("🦊🦊", "🦊🦊"), true);
  });

  test("PLANT: a prefix, an extension or another length is not equal", async () => {
    assert.equal(await safeEqual("abc", "abcd"), false);
    assert.equal(await safeEqual("abcd", "abc"), false);
    assert.equal(await safeEqual("a".repeat(64), "a".repeat(65)), false);
  });

  test("PLANT: an empty or missing side matches nothing, itself included", async () => {
    assert.equal(await safeEqual("", ""), false);
    assert.equal(await safeEqual(undefined, undefined), false);
    assert.equal(await safeEqual("undefined", undefined), false);
    assert.equal(await safeEqual(null, "null"), false);
    assert.equal(await safeEqual(42, "42"), false);
    assert.equal(await safeEqual("token", ""), false);
  });
}

describe("safeEqual, the XOR fallback (Node)", () => {
  test("Node has no crypto.subtle.timingSafeEqual, so these cases run the fallback", () => {
    assert.equal(typeof subtle.timingSafeEqual, "undefined");
  });
  sharedCases();
});

describe("safeEqual, crypto.subtle.timingSafeEqual (workerd)", () => {
  before(installNative);
  after(removeNative);
  sharedCases();

  test("PLANT: the runtime's primitive does the compare, always on 32 bytes against 32", async () => {
    nativeCalls.length = 0;
    assert.equal(await safeEqual("short", "a much longer presented value"), false);
    assert.equal(await safeEqual("same", "same"), true);
    assert.equal(nativeCalls.length, 2);
    for (const [x, y] of nativeCalls) {
      assert.equal(x.byteLength, 32);
      assert.equal(y.byteLength, 32);
    }
  });
});
