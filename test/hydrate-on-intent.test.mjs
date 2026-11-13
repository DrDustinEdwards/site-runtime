import assert from "node:assert/strict";
import { test } from "node:test";

test("a boot that failed to load is tried again on the next press, not handed back rejected", async () => {
  let entry = "./fixtures/missing-entry.mjs";
  const holder = {
    nonce: "",
    get textContent() {
      return JSON.stringify({
        preloads: [],
        routes: [],
        entry: entry.startsWith("data:") ? entry : new URL(entry, import.meta.url).href,
      });
    },
  };
  Object.assign(globalThis, {
    window: globalThis,
    sessionStorage: { getItem: () => null },
    document: {
      getElementById: () => holder,
      documentElement: { hasAttribute: () => false },
      head: { appendChild() {} },
    },
  });
  const { hydrateNow } = await import("../hydrate-on-intent.mjs");
  const error = console.error;
  console.error = () => {};
  try {
    await assert.rejects(hydrateNow());
    entry = "data:text/javascript,export {}";
    await hydrateNow();
  } finally {
    console.error = error;
  }
});
