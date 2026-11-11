import assert from "node:assert/strict";
import { test } from "node:test";
import { draftGate } from "../draft-gate.mjs";

test("draftGate: a missing row and a hidden draft are the same 404; the admin check runs only for a draft", async () => {
  let asked = 0;
  const no = () => (asked++, false);
  for (const row of [null, undefined, { status: "draft" }]) {
    const thrown = await draftGate(row, no).catch((e) => e);
    assert.ok(thrown instanceof Response);
    assert.equal(thrown.status, 404);
  }
  assert.equal(asked, 1);
  assert.deepEqual(await draftGate({ status: "published" }, no), {
    row: { status: "published" },
    draft: false,
  });
  assert.equal(asked, 1, "a public row never asks");
  assert.equal((await draftGate({ status: "draft" }, async () => true)).draft, true);
  assert.equal(
    (await draftGate({ empty: true }, () => true, { isDraft: (r) => r.empty })).draft,
    true,
  );
});
