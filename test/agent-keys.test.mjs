// Named agent keys: the name comes from the secret, never the request, and nothing blank or misnamed admits anyone.
import assert from "node:assert/strict";
import { test } from "node:test";

import { agentCaller, agentPrincipal } from "../agent-keys.mjs";

const SCOPES = { read: "sample.read", write: "sample.write" };

test("PLANT: a key names its own agent; a blank, misnamed or absent secret admits nobody", async () => {
  const env = { AGENT_KEY_GROK: "key-for-grok", AGENT_KEY_EMPTY: "  ", "AGENT_KEY_BAD NAME": "key-bad", OTHER: "key-other", AGENT_WRITE: "grok" };
  assert.deepEqual(await agentCaller(env, "Bearer key-for-grok", SCOPES), { kind: "agent", principal: "grok", scopes: ["sample.read", "sample.write"] });
  for (const header of ["Bearer   ", "Bearer key-bad", "Bearer key-other", "Basic key-for-grok", "key-for-grok", null]) {
    assert.equal(await agentPrincipal(env, header), null, String(header));
  }
  assert.deepEqual((await agentCaller({ AGENT_KEY_READER: "k2" }, "bearer k2", SCOPES))?.scopes, ["sample.read"]);
});
