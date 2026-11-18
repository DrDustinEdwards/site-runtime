// Named agent keys: the name comes from the secret, never the request, and nothing blank, short or misnamed admits anyone.
import assert from "node:assert/strict";
import { test } from "node:test";

import { agentCaller, agentPrincipal } from "../agent-keys.mjs";

const SCOPES = { read: "sample.read", write: "sample.write" };

const GROK = "key-for-grok-".padEnd(43, "g");
const READER = "key-for-reader-".padEnd(43, "r");

test("PLANT: a key names its own agent; a blank, short, misnamed or absent secret admits nobody", async () => {
  const env = {
    AGENT_KEY_GROK: GROK,
    AGENT_KEY_EMPTY: "  ",
    AGENT_KEY_SHORT: "placeholder",
    "AGENT_KEY_BAD NAME": "key-bad".padEnd(43, "b"),
    OTHER: "key-other".padEnd(43, "o"),
    AGENT_WRITE: "grok",
  };
  assert.deepEqual(await agentCaller(env, `Bearer ${GROK}`, SCOPES), {
    kind: "agent",
    principal: "grok",
    scopes: ["sample.read", "sample.write"],
  });
  for (const header of [
    "Bearer   ",
    "Bearer placeholder",
    `Bearer ${env["AGENT_KEY_BAD NAME"]}`,
    `Bearer ${env.OTHER}`,
    `Basic ${GROK}`,
    GROK,
    null,
  ]) {
    assert.equal(await agentPrincipal(env, header), null, String(header));
  }
  assert.deepEqual(
    (await agentCaller({ AGENT_KEY_READER: READER }, `bearer ${READER}`, SCOPES))?.scopes,
    ["sample.read"],
  );
});
