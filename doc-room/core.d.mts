/** A file's room without its Durable Object: who, the limits, the suggest gate and the comment rules (core.mjs). */
import type * as Y from "yjs";

/** Who a connection is: set by the app's door when it lets the connection in, never by the browser. Capsomer collab-editor's RoomViewer. */
export type RoomViewer = {
  id: number;
  name: string;
  /** Changes the text, or only suggests. */
  access: "edit" | "suggest";
  /** Deletes anyone's comment, not only their own (an app's owner). */
  deletesAny?: boolean;
};

/** What the room tracks about the shared copy besides its text. */
export type RoomMeta = { version: string | null; saved: string };

/**
 * The shared copy's operations, from the editor that defines it (Capsomer collab-editor): the room is
 * the same for any document model that gives these.
 */
export type DocModel = {
  /** The Y.Map holding the room's own state (version, saved text), which a suggester never changes. */
  metaKey: string;
  isSeeded(doc: Y.Doc): boolean;
  readMeta(doc: Y.Doc): RoomMeta;
  markdown(doc: Y.Doc): string;
  /** Loads `markdown` as the whole text (and the version and saved text). `input` carries the model's own options too. */
  load(
    doc: Y.Doc,
    input: { markdown: string; version: string | null; saved?: string } & Record<string, unknown>,
  ): void;
  markSaved(doc: Y.Doc, version: string | null, markdown: string): void;
  /** The document as JSON, for comparing. */
  json(doc: Y.Doc): unknown;
  /** The JSON with every suggestion rejected. */
  settle(json: unknown): unknown;
  /** How many suggestions each person (by id as a string) has in the JSON. */
  suggestionCounts(json: unknown): Map<string, number>;
};

/** One stored comment, as the store keeps it. */
export type StoredComment = {
  id: string;
  parentId: string | null;
  personId: number;
  body: string;
  anchor: string | null;
  quote: string;
  createdAt: string;
};

/** One comment as everyone in the room sees it. Capsomer collab-editor's RoomComment. */
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

/** Where a room's comment threads are kept: the app's own storage, scoped to the room's file. */
export type CommentStore = {
  /** Every comment not deleted, oldest first. */
  list(): Promise<RoomComment[]>;
  /** A comment not deleted, or null. */
  find(id: string): Promise<{ personId: number; parentId: string | null } | null>;
  add(comment: StoredComment): Promise<void>;
  edit(id: string, body: string, at: string): Promise<void>;
  /** `by` null reopens the thread. */
  resolve(id: string, by: number | null, at: string): Promise<void>;
  /** Marks it deleted, with its replies when `withReplies`. */
  remove(id: string, withReplies: boolean, at: string): Promise<void>;
};

export type CommentMessage =
  | { t: "comment"; body: string; anchor: string | null; quote: string; parentId?: string | null }
  | { t: "comment-edit"; id: string; body: string }
  | { t: "comment-resolve"; id: string; resolved: boolean }
  | { t: "comment-delete"; id: string };

export type ClientMessage = { t: "flush"; n: number } | CommentMessage;

export type RoomPerson = {
  conn: string;
  id: number;
  name: string;
  access: RoomViewer["access"];
  clients: number[];
};

/** Capsomer collab-editor's ServerMessage. */
export type ServerMessage =
  | { t: "people"; people: RoomPerson[] }
  | { t: "comments"; comments: RoomComment[] }
  | { t: "flushed"; n: number }
  | { t: "refused"; reason: string }
  | { t: "replaced"; by: string }
  | { t: "error"; message: string };

export const DOC_ROOM_VIEWER_HEADER: "x-doc-room-viewer";
export const ROLE_RECHECK_MS: number;
export const MAX_SUGGESTION: number;
export const MAX_EDIT: number;
export const MAX_COMMENT: number;
export const MAX_QUOTE: number;
export const MAX_ANCHOR: number;

/** The forwarded request with the person on it, for the room's stub. */
export function viewerRequest(request: Request, viewer: RoomViewer): Request;
/** The person the door put on this request, or null. */
export function readViewer(request: Request): RoomViewer | null;
/** Whether a message of `size` bytes is within this access's limit. */
export function withinLimit(size: number, access: RoomViewer["access"]): boolean;
/** Whether `update` changes only suggestions, and only `by`'s own. */
export function suggestOnly(model: DocModel, doc: Y.Doc, update: Uint8Array, by: number): boolean;
/** Carries out a comment message; the refusal to show, or null when done. */
export function applyComment(
  store: CommentStore,
  viewer: RoomViewer,
  message: CommentMessage,
  now?: string,
): Promise<string | null>;
