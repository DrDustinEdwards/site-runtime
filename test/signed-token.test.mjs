// The emailed-link token: it round-trips, refuses any change, and survives a key rotation. PLANT tests fail if the
// guard they name is removed.
import assert from "node:assert/strict";
import { test } from "node:test";

import { readSignedToken, signToken } from "../signed-token.mjs";

const OLD = "11".repeat(32);
const NEW = "22".repeat(32);

test("a token round-trips its payload", async () => {
  const token = await signToken([NEW], { a: "acct_1", k: "unsub" });
  assert.deepEqual(await readSignedToken([NEW], token), { a: "acct_1", k: "unsub" });
});

test("PLANT: a changed payload, signature or key is refused", async () => {
  const token = await signToken([NEW], { a: "acct_1" });
  const [payload, signature] = token.split(".");
  const forged = `${Buffer.from(JSON.stringify({ a: "acct_2" })).toString("base64url")}.${signature}`;
  assert.equal(await readSignedToken([NEW], forged), null);
  assert.equal(await readSignedToken([NEW], `${payload}.${signature?.slice(0, -2)}AA`), null);
  assert.equal(await readSignedToken([OLD], token), null);
  for (const bad of ["", ".", "abc", ".abc", "abc.", "!!.!!"]) assert.equal(await readSignedToken([NEW], bad), null, bad);
});

test("PLANT: a rotation signs with the first key and still reads links signed with the old one", async () => {
  const before = await signToken([undefined, OLD], { n: 1 });
  const after = await signToken([NEW, OLD], { n: 2 });
  assert.equal(await readSignedToken([OLD], after), null, "the new link is signed with the new key");
  assert.deepEqual(await readSignedToken([NEW, OLD], before), { n: 1 });
  assert.deepEqual(await readSignedToken([NEW, OLD], after), { n: 2 });
  assert.equal(await readSignedToken([NEW], before), null, "dropping the old key retires its links");
});

test("a payload that is not a JSON object reads as null; no key at all throws", async () => {
  for (const value of [[1], "text", 3, null]) {
    const token = await signToken([NEW], /** @type {object} */ (/** @type {unknown} */ (value)));
    assert.equal(await readSignedToken([NEW], token), null, JSON.stringify(value));
  }
  await assert.rejects(signToken([undefined, ""], {}), /no signing key/);
  await assert.rejects(readSignedToken([], "a.b"), /no signing key/);
});
