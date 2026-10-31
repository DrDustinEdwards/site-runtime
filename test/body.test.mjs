import assert from "node:assert/strict";
import { test } from "node:test";

import { readCapped, readCappedBytes } from "../body.mjs";

/** A body that arrives in the given chunks, and records whether the reader canceled it. */
function chunked(parts, { failAfter } = {}) {
  const state = { canceled: false };
  let i = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (failAfter !== undefined && i === failAfter) return controller.error(new Error("connection reset"));
      if (i === parts.length) return controller.close();
      controller.enqueue(new TextEncoder().encode(parts[i++]));
    },
    cancel() {
      state.canceled = true;
    },
  });
  return { source: { body }, state };
}

test("reads the whole body when it fits, across chunks", async () => {
  assert.equal(await readCapped(chunked(["ab", "cd", "é"]).source, 6), "abcdé");
  assert.equal(await readCapped(new Request("https://example.com/", { method: "POST", body: "{}" }), 2), "{}");
});

test("no body is the empty string, not null", async () => {
  assert.equal(await readCapped({ body: null }, 10), "");
  assert.deepEqual(await readCappedBytes({ body: null }, 10), new Uint8Array(0));
});

test("PLANT: one byte over the ceiling is null and the stream is canceled, whatever Content-Length said", async () => {
  const { source, state } = chunked(["abc", "def", "never read"]);
  assert.equal(await readCapped(source, 5), null);
  assert.equal(state.canceled, true);
  const understated = new Request("https://example.com/", { method: "POST", body: "x".repeat(11), headers: { "content-length": "1" } });
  assert.equal(await readCapped(understated, 10), null);
});

test("a stream that fails mid-read throws, so no caller parses a fragment as the body", async () => {
  await assert.rejects(readCapped(chunked(["abc", "def"], { failAfter: 1 }).source, 100), /the body stream failed after 3 bytes: connection reset/);
});

test("the ceiling is a whole number of bytes", async () => {
  await assert.rejects(readCapped({ body: null }, -1), RangeError);
  await assert.rejects(readCapped({ body: null }, 1.5), RangeError);
});

test("an oversize clone returns null without waiting on the original, which still reads in full", async () => {
  const request = new Request("https://example.com/", { method: "POST", body: "x".repeat(64) });
  const clone = request.clone();
  const verdict = await Promise.race([readCappedBytes(clone, 8), new Promise((resolve) => setTimeout(() => resolve("hung"), 1000))]);
  assert.equal(verdict, null);
  assert.equal((await request.text()).length, 64);
});
