import assert from "node:assert/strict";
import { test } from "node:test";

import { keyIdOf, keyringFromEnv, open, reseal, seal } from "../secret-box.mjs";

// Moved from Foxhound's key-rotation test (ruling 312): the format carries a key id, so a rotation can tell which key
// sealed a value; without it every stored token would become unreadable at once.
const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);
const ringA = keyringFromEnv({ ENCRYPTION_KEY: KEY_A });
const ringRotated = keyringFromEnv({
  ENCRYPTION_KEY: KEY_B,
  ENCRYPTION_KEY_ID: "k2",
  ENCRYPTION_KEYS_OLD: `k1:${KEY_A}`,
});

test("reseal moves a value onto the active key, and is a no-op when it is already there", async () => {
  const moved = await reseal(ringRotated, await seal(ringA, "subject"));
  assert.ok(moved);
  assert.equal(keyIdOf(moved), "k2");
  assert.equal(await open(ringRotated, moved), "subject");
  assert.equal(await reseal(ringRotated, moved), null);
});

test("an unknown key id, a malformed value and a bad keyring fail loud", async () => {
  await assert.rejects(open(ringA, await seal(ringRotated, "x")), /No key for id 'k2'/);
  await assert.rejects(open(ringA, "v9:k1:aa:bb"), /Malformed/);
  assert.throws(
    () => keyringFromEnv({ ENCRYPTION_KEY: KEY_A, ENCRYPTION_KEYS_OLD: `k1:${KEY_B}` }),
    /reuses the active key id/,
  );
  assert.throws(
    () => keyringFromEnv({ ENCRYPTION_KEY: KEY_A, ENCRYPTION_KEYS_OLD: "k0:short" }),
    /32 bytes/,
  );
  assert.throws(() => keyringFromEnv({}), /ENCRYPTION_KEY is not set/);
});
