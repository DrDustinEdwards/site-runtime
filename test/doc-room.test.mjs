import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";

import {
  applyComment,
  readViewer,
  suggestOnly,
  viewerRequest,
  DOC_ROOM_VIEWER_HEADER,
} from "../doc-room/core.mjs";

/** A stand-in document model: the text is a Y.Map, each suggestion an entry "person:n" in another. */
const model = {
  metaKey: "meta",
  /** @param {Y.Doc} doc */
  json: (doc) => ({ text: doc.getMap("text").toJSON(), suggest: doc.getMap("suggest").toJSON() }),
  /** @param {any} json */
  settle: (json) => json.text,
  /** @param {any} json */
  suggestionCounts: (json) => {
    const counts = new Map();
    for (const key of Object.keys(json.suggest)) {
      const person = key.split(":")[0];
      counts.set(person, (counts.get(person) ?? 0) + 1);
    }
    return counts;
  },
};

/** The update `change` makes to a copy of `room`. @param {Y.Doc} room @param {(d: Y.Doc) => void} change */
function updateOf(room, change) {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(room));
  const before = Y.encodeStateVector(copy);
  change(copy);
  return Y.encodeStateAsUpdate(copy, before);
}

test("PLANT: a suggester changes only their own suggestions, never the text, the room's state or another's", () => {
  const room = new Y.Doc();
  room.getMap("text").set("p1", "It was a dark night.");
  room.getMap("meta").set("version", "v1");
  room.getMap("suggest").set("9:1", "stormy");

  assert.equal(
    suggestOnly(
      model,
      room,
      updateOf(room, (d) => d.getMap("suggest").set("7:1", "cold")),
      7,
    ),
    true,
  );
  assert.equal(
    suggestOnly(
      model,
      room,
      updateOf(room, (d) => d.getMap("suggest").delete("7:1")),
      7,
    ),
    true,
  );
  assert.equal(
    suggestOnly(
      model,
      room,
      updateOf(room, (d) => d.getMap("text").set("p1", "Bright.")),
      7,
    ),
    false,
  );
  assert.equal(
    suggestOnly(
      model,
      room,
      updateOf(room, (d) => d.getMap("meta").set("version", "v2")),
      7,
    ),
    false,
  );
  assert.equal(
    suggestOnly(
      model,
      room,
      updateOf(room, (d) => d.getMap("suggest").set("9:2", "x")),
      7,
    ),
    false,
  );
  assert.equal(suggestOnly(model, room, new Uint8Array([1, 2, 3]), 7), false);
  // Nothing tried reached the room.
  assert.deepEqual(room.getMap("text").toJSON(), { p1: "It was a dark night." });
  assert.deepEqual(Object.keys(room.getMap("suggest").toJSON()), ["9:1"]);
});

test("comments: replies hang off a thread, writers change their own, editors resolve, the owner deletes any", async () => {
  /** @type {Map<string, any>} */
  const rows = new Map();
  const store = {
    list: async () => [...rows.values()],
    find: async (/** @type {string} */ id) => rows.get(id) ?? null,
    add: async (/** @type {any} */ c) => void rows.set(c.id, c),
    edit: async (/** @type {string} */ id, /** @type {string} */ body) =>
      void (rows.get(id).body = body),
    resolve: async (/** @type {string} */ id, /** @type {number | null} */ by) =>
      void (rows.get(id).resolvedBy = by),
    remove: async (/** @type {string} */ id, /** @type {boolean} */ withReplies) => {
      rows.delete(id);
      if (withReplies) for (const [k, r] of rows) if (r.parentId === id) rows.delete(k);
    },
  };
  const reader = { id: 2, name: "Reader", access: /** @type {const} */ ("suggest") };
  const editor = { id: 3, name: "Editor", access: /** @type {const} */ ("edit") };
  const owner = { id: 1, name: "Owner", access: /** @type {const} */ ("edit"), deletesAny: true };

  assert.equal(
    await applyComment(store, editor, {
      t: "comment",
      body: "Tighten this.",
      anchor: "a",
      quote: "q",
    }),
    null,
  );
  const [thread] = [...rows.keys()];
  assert.equal(
    await applyComment(store, reader, {
      t: "comment",
      body: "Agreed.",
      anchor: "x",
      quote: "y",
      parentId: thread,
    }),
    null,
  );
  const reply = [...rows.values()].find((r) => r.parentId === thread);
  assert.equal(reply.anchor, null, "a reply takes its place from the thread");
  assert.equal(
    await applyComment(store, reader, {
      t: "comment",
      body: "Deeper.",
      anchor: null,
      quote: "",
      parentId: reply.id,
    }),
    "That thread is gone.",
  );
  assert.match(
    String(await applyComment(store, reader, { t: "comment", body: " ", anchor: null, quote: "" })),
    /1 to 10,000/,
  );

  assert.match(
    String(await applyComment(store, reader, { t: "comment-edit", id: thread, body: "Mine now." })),
    /Only the person/,
  );
  assert.match(
    String(await applyComment(store, reader, { t: "comment-resolve", id: thread, resolved: true })),
    /edit rights/,
  );
  assert.equal(
    await applyComment(store, editor, { t: "comment-resolve", id: thread, resolved: true }),
    null,
  );
  assert.equal(rows.get(thread).resolvedBy, 3);

  assert.match(
    String(await applyComment(store, reader, { t: "comment-delete", id: thread })),
    /or the owner/,
  );
  assert.equal(await applyComment(store, owner, { t: "comment-delete", id: thread }), null);
  assert.equal(rows.size, 0, "the thread took its reply with it");
});

test("the room trusts only a well-formed viewer the door set", () => {
  const viewer = { id: 4, name: "Ann", access: /** @type {const} */ ("suggest") };
  assert.deepEqual(readViewer(viewerRequest(new Request("https://example.com/r"), viewer)), viewer);
  assert.equal(readViewer(new Request("https://example.com/r")), null);
  for (const raw of [
    "not json",
    '{"id":"4","name":"Ann","access":"edit"}',
    '{"id":4,"name":"Ann","access":"owner"}',
  ])
    assert.equal(
      readViewer(
        new Request("https://example.com/r", { headers: { [DOC_ROOM_VIEWER_HEADER]: raw } }),
      ),
      null,
    );
});
