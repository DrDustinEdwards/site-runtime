/**
 * The forwarded request with the person on it: what the app's door hands the room's stub.
 * @param {Request} request
 * @param {RoomViewer} viewer
 */
export function viewerRequest(request: Request, viewer: RoomViewer): Request<unknown, CfProperties<unknown>>;
/**
 * The person the door put on this request, or null when there is none or it is not one.
 * @param {Request} request
 * @returns {RoomViewer | null}
 */
export function readViewer(request: Request): RoomViewer | null;
/**
 * Whether a message of this many bytes is within what this person may send.
 * @param {number} size
 * @param {"edit" | "suggest"} access
 */
export function withinLimit(size: number, access: "edit" | "suggest"): boolean;
/**
 * Whether `update` changes only suggestions, and only the suggester's own: with every suggestion
 * rejected the document reads the same before and after, the room's own map is untouched, and everyone
 * else's suggestions are as they were. Tried on a copy, so a refused update never reaches the room.
 * @param {DocModel} model
 * @param {Y.Doc} doc
 * @param {Uint8Array} update
 * @param {number} by
 */
export function suggestOnly(model: DocModel, doc: Y.Doc, update: Uint8Array, by: number): boolean;
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
export function applyComment(store: CommentStore, viewer: RoomViewer, message: CommentMessage, now?: string): Promise<string | null>;
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
export function viewerOf(conn: Connection): RoomViewer | null;
/** @param {import("partyserver").WSMessage} message */
export function messageBytes(message: import("partyserver").WSMessage): Uint8Array<ArrayBufferLike> | null;
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
export const DOC_ROOM_VIEWER_HEADER: "x-doc-room-viewer";
/**
 * How long a connection's access holds before the room asks the app again. Every message from an open
 * editor (its changes, and the presence it renews every 15 seconds while idle) waits on that check once
 * a window, so access taken away stops working within about this long plus 15 seconds.
 */
export const ROLE_RECHECK_MS: 10000;
/**
 * The largest message the room takes, in bytes. A suggestion is tried on a copy of the whole document
 * (`suggestOnly`), so a suggester's is a few words to a few pages, far below 256 KiB. An editor's is
 * applied, stored and sent to everyone, and after time offline it is the whole catch-up (sync step 2),
 * which for a book can be a large share of it: refusing it would drop that work, so an editor's cap only
 * bounds a runaway client, well inside Cloudflare's 32 MiB WebSocket message limit.
 */
export const MAX_SUGGESTION: number;
export const MAX_EDIT: number;
export const MAX_COMMENT: 10000;
export const MAX_QUOTE: 500;
export const MAX_ANCHOR: 2000;
/**
 * A comment thread brought in with a document: the words it is on (`from` to `to`, the document's
 * positions), then its comments in order, the first the thread and the rest its replies.
 */
export type BroughtThread = {
    from: number;
    to: number;
    quote: string;
    comments: {
        personId: number;
        body: string;
        createdAt?: string;
    }[];
};
export type ReplaceInput = {
    markdown: string;
    version: string | null;
    by: string;
    expectedVersion?: string | null | undefined;
    unsaved?: boolean | undefined;
    expectedMarkdown?: string | undefined;
    saved?: string | undefined;
    /**
     * The editor's JSON, loaded instead of `markdown` read: a document brought in with its suggestions.
     */
    doc?: unknown;
    /**
     * Its comment threads, anchored by the model's `anchor` once the document is in.
     */
    threads?: BroughtThread[] | undefined;
};
export type Connection = import("partyserver").Connection;
export type ConnState = {
    viewer?: RoomViewer;
    checkedAt?: number;
};
/**
 * Who a connection is: set by the app's door when it lets the connection in, never by the browser. Capsomer collab-editor's RoomViewer.
 */
export type RoomViewer = {
    id: number;
    name: string;
    /**
     * Changes the text, or only suggests.
     */
    access: "edit" | "suggest";
    /**
     * Deletes anyone's comment, not only their own (an app's owner).
     */
    deletesAny?: boolean | undefined;
};
/**
 * What the room tracks about the shared copy besides its text.
 */
export type RoomMeta = {
    version: string | null;
    saved: string;
};
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
 */
export type DocModel = {
    metaKey: string;
    isSeeded(doc: Y.Doc): boolean;
    readMeta(doc: Y.Doc): RoomMeta;
    markdown(doc: Y.Doc): string;
    load(doc: Y.Doc, input: {
        markdown: string;
        version: string | null;
        saved?: string;
    } & Record<string, unknown>): void;
    markSaved(doc: Y.Doc, version: string | null, markdown: string): void;
    json(doc: Y.Doc): unknown;
    settle(json: unknown): unknown;
    suggestions(json: unknown): Map<string, unknown>;
    anchor?(doc: Y.Doc, from: number, to: number): string | null;
};
/**
 * One stored comment, as the store keeps it.
 */
export type StoredComment = {
    id: string;
    parentId: string | null;
    personId: number;
    body: string;
    anchor: string | null;
    quote: string;
    createdAt: string;
};
/**
 * One comment as everyone in the room sees it. Capsomer collab-editor's RoomComment.
 */
export type RoomComment = {
    id: string;
    parentId: string | null;
    personId: number;
    name: string;
    body: string;
    anchor: string | null;
    quote: string;
    createdAt: string;
    editedAt: string | null;
    resolvedAt: string | null;
};
/**
 * Where a room's comment threads are kept: the app's own storage, scoped to the room's file.
 *
 * - `list`: Every comment not deleted, oldest first.
 * - `find`: A comment not deleted, or null.
 * - `resolve`: `by` null reopens the thread.
 * - `remove`: Marks it deleted, with its replies when `withReplies`.
 */
export type CommentStore = {
    list(): Promise<RoomComment[]>;
    find(id: string): Promise<{
        personId: number;
        parentId: string | null;
    } | null>;
    add(comment: StoredComment): Promise<void>;
    edit(id: string, body: string, at: string): Promise<void>;
    resolve(id: string, by: number | null, at: string): Promise<void>;
    remove(id: string, withReplies: boolean, at: string): Promise<void>;
};
export type CommentMessage = {
    t: "comment";
    body: string;
    anchor: string | null;
    quote: string;
    parentId?: string | null;
} | {
    t: "comment-edit";
    id: string;
    body: string;
} | {
    t: "comment-resolve";
    id: string;
    resolved: boolean;
} | {
    t: "comment-delete";
    id: string;
};
export type ClientMessage = {
    t: "flush";
    n: number;
} | CommentMessage;
export type RoomPerson = {
    conn: string;
    id: number;
    name: string;
    access: RoomViewer["access"];
    clients: number[];
};
/**
 * Capsomer collab-editor's ServerMessage.
 */
export type ServerMessage = {
    t: "people";
    people: RoomPerson[];
} | {
    t: "comments";
    comments: RoomComment[];
} | {
    t: "flushed";
    n: number;
} | {
    t: "refused";
    reason: string;
} | {
    t: "replaced";
    by: string;
} | {
    t: "error";
    message: string;
};
import * as Y from "yjs";
