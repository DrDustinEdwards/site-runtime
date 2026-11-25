// The parts of a file's room that need no Durable Object: who a connection is, the size limits, the gate
// that lets a suggester change only suggestions, and the comment rules. The room itself is ./index.mjs.

import * as Y from "yjs";

/**
 * Who a connection is: set by the app's door when it lets the connection in, never by the browser. Capsomer collab-editor's RoomViewer.
 * @typedef {object} RoomViewer
 * @property {number} id
 * @property {string} name
 * @property {"edit" | "suggest"} access Changes the text, or only suggests.
 * @property {boolean} [deletesAny] Deletes anyone's comment, not only their own (an app's owner).
 */

/**
 * What the room tracks about the shared copy besides its text.
 * @typedef {object} RoomMeta
 * @property {string | null} version
 * @property {string} saved
 */

/**
 * The shared copy's operations, from the editor that defines it (Capsomer collab-editor): the room is
 * the same for any document model that gives these.
 *
 * - `metaKey`: The Y.Map holding the room's own state (version, saved text), which a suggester never changes.
 * - `load`: Loads `markdown` as the whole text (and the version and saved text). `input` carries the model's own options too.
 * - `json`: The document as JSON, for comparing.
 * - `settle`: The JSON with every suggestion rejected.
 * - `suggestions`: Each person's suggestions in the JSON (by id as a string): what they suggested, compared as JSON.
 * - `anchor`: A comment's anchor on the text from `from` to `to` (Capsomer collab-editor's anchorAt), for threads brought in with a document.
 * @typedef {{ metaKey: string; isSeeded(doc: Y.Doc): boolean; readMeta(doc: Y.Doc): RoomMeta; markdown(doc: Y.Doc): string; load( doc: Y.Doc, input: { markdown: string; version: string | null; saved?: string } & Record<string, unknown>, ): void; markSaved(doc: Y.Doc, version: string | null, markdown: string): void; json(doc: Y.Doc): unknown; settle(json: unknown): unknown; suggestions(json: unknown): Map<string, unknown>; anchor?(doc: Y.Doc, from: number, to: number): string | null; }} DocModel
 */

/**
 * One stored comment, as the store keeps it.
 * @typedef {object} StoredComment
 * @property {string} id
 * @property {string | null} parentId
 * @property {number} personId
 * @property {string} body
 * @property {string | null} anchor
 * @property {string} quote
 * @property {string} createdAt
 */

/**
 * One comment as everyone in the room sees it. Capsomer collab-editor's RoomComment.
 * @typedef {object} RoomComment
 * @property {string} id
 * @property {string | null} parentId
 * @property {number} personId
 * @property {string} name
 * @property {string} body
 * @property {string | null} anchor
 * @property {string} quote
 * @property {string} createdAt
 * @property {string | null} editedAt
 * @property {string | null} resolvedAt
 */

/**
 * Where a room's comment threads are kept: the app's own storage, scoped to the room's file.
 *
 * - `list`: Every comment not deleted, oldest first.
 * - `find`: A comment not deleted, or null.
 * - `resolve`: `by` null reopens the thread.
 * - `remove`: Marks it deleted, with its replies when `withReplies`.
 * @typedef {{ list(): Promise<RoomComment[]>; find(id: string): Promise<{ personId: number; parentId: string | null } | null>; add(comment: StoredComment): Promise<void>; edit(id: string, body: string, at: string): Promise<void>; resolve(id: string, by: number | null, at: string): Promise<void>; remove(id: string, withReplies: boolean, at: string): Promise<void>; }} CommentStore
 */

/**
 * @typedef {| { t: "comment"; body: string; anchor: string | null; quote: string; parentId?: string | null }
 * | { t: "comment-edit"; id: string; body: string }
 * | { t: "comment-resolve"; id: string; resolved: boolean }
 * | { t: "comment-delete"; id: string }} CommentMessage
 */

/**
 * @typedef {{ t: "flush"; n: number } | CommentMessage} ClientMessage
 */

/**
 * @typedef {object} RoomPerson
 * @property {string} conn
 * @property {number} id
 * @property {string} name
 * @property {RoomViewer["access"]} access
 * @property {number[]} clients
 */

/**
 * Capsomer collab-editor's ServerMessage.
 * @typedef {| { t: "people"; people: RoomPerson[] }
 * | { t: "comments"; comments: RoomComment[] }
 * | { t: "flushed"; n: number }
 * | { t: "refused"; reason: string }
 * | { t: "replaced"; by: string }
 * | { t: "error"; message: string }} ServerMessage
 */

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
 * @param {RoomViewer} viewer
 */
export function viewerRequest(request, viewer) {
  const headers = new Headers(request.headers);
  headers.set(DOC_ROOM_VIEWER_HEADER, JSON.stringify(viewer));
  return new Request(request, { headers });
}

/**
 * The person the door put on this request, or null when there is none or it is not one.
 * @param {Request} request
 * @returns {RoomViewer | null}
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
 * rejected the document reads the same before and after, the room's own map is untouched, and everyone
 * else's suggestions are as they were. Tried on a copy, so a refused update never reaches the room.
 * @param {DocModel} model
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
  // Another's suggestions stay exactly as they were: reworded, they would be accepted as words they never wrote.
  const was = model.suggestions(before);
  const now = model.suggestions(after);
  for (const person of new Set([...was.keys(), ...now.keys()]))
    if (
      person !== String(by) &&
      JSON.stringify(was.get(person)) !== JSON.stringify(now.get(person))
    )
      return false;
  return true;
}

/**
 * Carries out one comment message for `viewer` on `store`, and gives back the refusal to show them, or
 * null when it was done. Everyone in the room comments; a comment is changed only by its writer; a
 * thread is resolved by its starter or by someone who edits; a comment is deleted by its writer or by
 * someone who `deletesAny`, and a thread's first comment takes its replies with it.
 * @param {CommentStore} store
 * @param {RoomViewer} viewer
 * @param {CommentMessage} message
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

/**
 * A comment thread brought in with a document: the words it is on (`from` to `to`, the document's
 * positions), then its comments in order, the first the thread and the rest its replies.
 * @typedef {object} BroughtThread
 * @property {number} from
 * @property {number} to
 * @property {string} quote
 * @property {{ personId: number; body: string; createdAt?: string }[]} comments
 */

/**
 * @typedef {object} ReplaceInput
 * @property {string} markdown
 * @property {string | null} version
 * @property {string} by
 * @property {string | null} [expectedVersion]
 * @property {boolean} [unsaved]
 * @property {string} [expectedMarkdown]
 * @property {string} [saved]
 * @property {unknown} [doc] The editor's JSON, loaded instead of `markdown` read: a document brought in with its suggestions.
 * @property {BroughtThread[]} [threads] Its comment threads, anchored by the model's `anchor` once the document is in.
 */

/** @typedef {import("partyserver").Connection} Connection */
/** @typedef {{ viewer?: RoomViewer; checkedAt?: number }} ConnState */

/** @param {Connection} conn */
export function viewerOf(conn) {
  return /** @type {ConnState | null} */ (conn.state)?.viewer ?? null;
}

/** @param {import("partyserver").WSMessage} message */
export function messageBytes(message) {
  if (typeof message === "string") return null;
  return message instanceof ArrayBuffer
    ? new Uint8Array(message)
    : new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
}
