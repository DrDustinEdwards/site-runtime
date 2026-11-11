// The parts of a file's room that need no Durable Object: who a connection is, the size limits, the gate
// that lets a suggester change only suggestions, and the comment rules. The room itself is ./index.mjs.

import * as Y from "yjs";

/**
 * The header the app's own door sets on the WebSocket it forwards to the room, saying who the person is
 * (JSON of a RoomViewer). The browser never reaches the room directly, so nothing else sets it.
 */
export const DOC_ROOM_VIEWER_HEADER = "x-doc-room-viewer";

/**
 * How long a connection's access holds before the room asks the app again. Every message from an open
 * editor (its changes, and the presence it renews every 15 seconds while idle) waits on that check once
 * a window, so access taken away stops working within about this long plus 15 seconds.
 */
export const ROLE_RECHECK_MS = 10_000;

/**
 * The largest message the room takes, in bytes. A suggestion is tried on a copy of the whole document
 * (`suggestOnly`), so a suggester's is a few words to a few pages, far below 256 KiB. An editor's is
 * applied, stored and sent to everyone, and after time offline it is the whole catch-up (sync step 2),
 * which for a book can be a large share of it: refusing it would drop that work, so an editor's cap only
 * bounds a runaway client, well inside Cloudflare's 32 MiB WebSocket message limit.
 */
export const MAX_SUGGESTION = 256 * 1024;
export const MAX_EDIT = 8 * 1024 * 1024;

export const MAX_COMMENT = 10_000;
export const MAX_QUOTE = 500;
export const MAX_ANCHOR = 2_000;

/**
 * The forwarded request with the person on it: what the app's door hands the room's stub.
 * @param {Request} request
 * @param {import("./core.d.mts").RoomViewer} viewer
 */
export function viewerRequest(request, viewer) {
  const headers = new Headers(request.headers);
  headers.set(DOC_ROOM_VIEWER_HEADER, JSON.stringify(viewer));
  return new Request(request, { headers });
}

/**
 * The person the door put on this request, or null when there is none or it is not one.
 * @param {Request} request
 * @returns {import("./core.d.mts").RoomViewer | null}
 */
export function readViewer(request) {
  const raw = request.headers.get(DOC_ROOM_VIEWER_HEADER);
  if (!raw) return null;
  let v;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !v ||
    typeof v !== "object" ||
    !Number.isInteger(v.id) ||
    typeof v.name !== "string" ||
    (v.access !== "edit" && v.access !== "suggest")
  )
    return null;
  return {
    id: v.id,
    name: v.name,
    access: v.access,
    ...(v.deletesAny ? { deletesAny: true } : {}),
  };
}

/**
 * Whether a message of this many bytes is within what this person may send.
 * @param {number} size
 * @param {"edit" | "suggest"} access
 */
export function withinLimit(size, access) {
  return size <= (access === "suggest" ? MAX_SUGGESTION : MAX_EDIT);
}

/**
 * Whether `update` changes only suggestions, and only the suggester's own: with every suggestion
 * rejected the document reads the same before and after, the room's own map is untouched, and nobody
 * else has more suggested. Tried on a copy, so a refused update never reaches the room.
 * @param {import("./core.d.mts").DocModel} model
 * @param {Y.Doc} doc
 * @param {Uint8Array} update
 * @param {number} by
 */
export function suggestOnly(model, doc, update, by) {
  const probe = new Y.Doc();
  Y.applyUpdate(probe, Y.encodeStateAsUpdate(doc));
  const before = model.json(probe);
  try {
    Y.applyUpdate(probe, update);
  } catch {
    return false;
  }
  const after = model.json(probe);
  // The rest of the room's state (the version, the saved text) is never a suggester's to change.
  if (
    JSON.stringify(probe.getMap(model.metaKey).toJSON()) !==
    JSON.stringify(doc.getMap(model.metaKey).toJSON())
  )
    return false;
  if (JSON.stringify(model.settle(before)) !== JSON.stringify(model.settle(after))) return false;
  const was = model.suggestionCounts(before);
  for (const [person, n] of model.suggestionCounts(after))
    if (person !== String(by) && n > (was.get(person) ?? 0)) return false;
  return true;
}

/**
 * Carries out one comment message for `viewer` on `store`, and gives back the refusal to show them, or
 * null when it was done. Everyone in the room comments; a comment is changed only by its writer; a
 * thread is resolved by its starter or by someone who edits; a comment is deleted by its writer or by
 * someone who `deletesAny`, and a thread's first comment takes its replies with it.
 * @param {import("./core.d.mts").CommentStore} store
 * @param {import("./core.d.mts").RoomViewer} viewer
 * @param {import("./core.d.mts").CommentMessage} message
 * @param {string} [now]
 * @returns {Promise<string | null>}
 */
export async function applyComment(store, viewer, message, now = new Date().toISOString()) {
  const tooLong = `A comment is 1 to ${MAX_COMMENT.toLocaleString("en")} characters.`;
  switch (message.t) {
    case "comment": {
      const body = String(message.body ?? "").trim();
      if (!body || body.length > MAX_COMMENT) return tooLong;
      const parentId = message.parentId ? String(message.parentId) : null;
      // A reply hangs off the thread's first comment, and takes its place in the text from it.
      const parent = parentId ? await store.find(parentId) : null;
      if (parentId && (!parent || parent.parentId)) return "That thread is gone.";
      await store.add({
        id: crypto.randomUUID(),
        parentId,
        personId: viewer.id,
        body,
        anchor: parentId
          ? null
          : message.anchor
            ? String(message.anchor).slice(0, MAX_ANCHOR)
            : null,
        quote: parentId ? "" : String(message.quote ?? "").slice(0, MAX_QUOTE),
        createdAt: now,
      });
      return null;
    }
    case "comment-edit": {
      const id = String(message.id);
      const row = await store.find(id);
      const body = String(message.body ?? "").trim();
      if (!row || row.personId !== viewer.id)
        return "Only the person who wrote a comment can change it.";
      if (!body || body.length > MAX_COMMENT) return tooLong;
      await store.edit(id, body, now);
      return null;
    }
    case "comment-resolve": {
      const id = String(message.id);
      const row = await store.find(id);
      if (!row || row.parentId) return "That thread is gone.";
      if (row.personId !== viewer.id && viewer.access !== "edit")
        return "Resolving a thread takes edit rights, or having started it.";
      await store.resolve(id, message.resolved ? viewer.id : null, now);
      return null;
    }
    case "comment-delete": {
      const id = String(message.id);
      const row = await store.find(id);
      if (!row || (row.personId !== viewer.id && !viewer.deletesAny))
        return "Only the person who wrote a comment, or the owner, can delete it.";
      await store.remove(id, !row.parentId, now);
      return null;
    }
    default:
      return "That is not a comment message.";
  }
}
