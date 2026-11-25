import assert from "node:assert/strict";
import { test } from "node:test";

import { mintConfirm, redeemConfirm } from "../confirm-token.mjs";
import { confirmationRequired, confirmationSatisfied } from "../confirm.mjs";

const form = (fields) => new Map(Object.entries(fields));

test("a destructive request needs confirmed=1, and the typed word in any case when one is asked for", async () => {
  assert.equal(confirmationSatisfied(form({ intent: "delete" })), false);
  assert.equal(confirmationSatisfied(form({ confirmed: "0" })), false);
  assert.equal(confirmationSatisfied(form({ confirmed: "1" })), true);
  assert.equal(confirmationSatisfied(form({ confirmed: "1" }), "remove"), false);
  assert.equal(confirmationSatisfied(form({ confirmed: "1", confirm: "nope" }), "remove"), false);
  assert.equal(
    confirmationSatisfied(form({ confirmed: "1", confirm: " Remove " }), "remove"),
    true,
  );
  assert.equal(confirmationSatisfied(form({ confirm: "remove" }), "remove"), false);
  const res = confirmationRequired();
  assert.equal(res.status, 400);
  assert.match(await res.text(), /Nothing was changed/);
});

test("a perform must name the claims it acts on", async () => {
  const keys = ["a".repeat(64)];
  const { token } = await mintConfirm({ keys, claims: { actor: "a@example.com" } });
  await assert.rejects(redeemConfirm({ keys, token }), TypeError);
  assert.equal((await redeemConfirm({ keys, token, expect: { actor: "a@example.com" } })).ok, true);
});
