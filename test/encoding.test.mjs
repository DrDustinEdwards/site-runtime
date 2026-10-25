import assert from "node:assert/strict";
import { test } from "node:test";

import { base64url, fromBase64, fromBase64url, fromHex, sha256Hex, toBase64, toHex } from "../encoding.mjs";

test("every length round-trips through base64url without padding, and through hex", () => {
  for (let n = 0; n < 8; n++) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => 250 + i);
    const url = base64url(bytes);
    assert.doesNotMatch(url, /[+/=]/);
    assert.deepEqual(fromBase64url(url), bytes);
    assert.deepEqual(fromHex(toHex(bytes)), bytes);
  }
});

test("base64 ignores the line breaks GitHub wraps it in, and strings are UTF-8", () => {
  assert.equal(new TextDecoder().decode(fromBase64(`${toBase64("café 🦊").slice(0, 4)}\n${toBase64("café 🦊").slice(4)}`)), "café 🦊");
});

test("sha256Hex matches the published test vector", async () => {
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("a malformed hex string throws instead of decoding to the wrong bytes", () => {
  assert.throws(() => fromHex("abc"));
  assert.throws(() => fromHex("zz"));
});
