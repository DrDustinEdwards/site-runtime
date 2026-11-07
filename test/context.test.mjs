import assert from "node:assert/strict";
import { test } from "node:test";

import { RouterContextProvider } from "react-router";

import { cspNonceContext, getNonce } from "../context.mjs";

test("getNonce is undefined when no render set it, and the nonce when one did", () => {
  assert.equal(getNonce(new RouterContextProvider()), undefined);
  const context = new RouterContextProvider();
  context.set(cspNonceContext, "abc");
  assert.equal(getNonce(context), "abc");
});
