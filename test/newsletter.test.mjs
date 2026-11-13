import assert from "node:assert/strict";
import { test } from "node:test";
import { newsletter } from "../newsletter.mjs";

test("a change of case in the address is the same row, so the resend window holds", async () => {
  /** @type {Map<string, { confirmedAt: null, unsubscribedAt: null, confirmSentAt: string | null }>} */
  const rows = new Map();
  /** @type {string[]} */
  const mailed = [];
  const list = newsletter({
    store: {
      find: async (email) => rows.get(email) ?? null,
      upsertPending: async (email, confirmSentAt) =>
        void rows.set(email, { confirmedAt: null, unsubscribedAt: null, confirmSentAt }),
      confirm: async () => false,
      unsubscribe: async () => false,
    },
    keys: ["00".repeat(32)],
    send: async ({ email }) => (mailed.push(email), true),
    origin: "https://example.com",
  });
  const now = new Date("2026-01-01T00:00:00Z");
  assert.equal(await list.request("A@Example.com", now), "sent");
  assert.equal(await list.request(" a@EXAMPLE.com ", now), "sent");
  assert.deepEqual(mailed, ["a@example.com"]);
  assert.deepEqual([...rows.keys()], ["a@example.com"]);
});
