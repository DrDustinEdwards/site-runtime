/** The room for one file: a Durable Object on y-partyserver that pairs with Capsomer's collab editor (index.mjs). */
import type { Connection, ConnectionContext, WSMessage } from "partyserver";
import { YServer } from "y-partyserver";
import type { CommentStore, DocModel, RoomMeta, RoomViewer } from "./core.mjs";

export * from "./core.mjs";

/**
 * The room an app extends and exports as its Durable Object class (SQLite-backed). It gives `model` and
 * `access`, and `comments` and `mirror` when it keeps them.
 */
export declare class DocRoom<E = Cloudflare.Env> extends YServer<E> {
  static options: { hibernate: boolean };
  static callbackOptions: { debounceWait: number; debounceMaxWait: number; timeout: number };
  /** The document's operations (Capsomer collab-editor's). */
  get model(): DocModel;
  /** What `viewer` may do now, or null when they may no longer be in the room. A throw closes the connection to reconnect. */
  access(viewer: RoomViewer): Promise<Pick<RoomViewer, "access" | "deletesAny"> | null>;
  /** Where the comment threads are kept; null (the default) for a room without comments. */
  get comments(): CommentStore | null;
  /** After every store of the working copy: the app's own copy, for its backup. */
  mirror(state: { markdown: string } & RoomMeta): Promise<void>;

  onLoad(): Promise<void>;
  onStart(): Promise<void>;
  onSave(): Promise<void>;

  /** Where the room stands. `seeded` false: nobody has opened the file since live editing began. */
  status(): Promise<{ seeded: boolean; meta: RoomMeta; markdown: string; people: number }>;
  /** The first load: the file's text as the app has it. Once only; false when already seeded. */
  seed(
    input: { markdown: string; version: string | null; saved?: string } & Record<string, unknown>,
  ): Promise<boolean>;
  /** Replaces the whole text for everyone; false when a precondition no longer holds. */
  replace(input: {
    markdown: string;
    version: string | null;
    by: string;
    expectedVersion?: string | null;
    unsaved?: boolean;
    expectedMarkdown?: string;
    saved?: string;
  }): Promise<boolean>;
  /** What a save writes now, its version, and who changed it since the last save. */
  snapshot(): Promise<{
    seeded: boolean;
    markdown: string;
    version: string | null;
    at: string;
    contributors: number[];
  }>;
  /** After a save: gives back who had a hand in the text saved. */
  saved(input: { version: string | null; markdown: string; snapshotAt: string }): Promise<number[]>;
  /** After a write that sent no text: the new version, when the app still holds the last saved text. */
  rebase(input: { version: string; source: string }): Promise<boolean>;

  onConnect(conn: Connection, ctx: ConnectionContext): void;
  onClose(conn: Connection, code: number, reason: string, wasClean: boolean): void;
  isReadOnly(conn: Connection): boolean;
  onMessage(conn: Connection, message: WSMessage): Promise<void>;
  onCustomMessage(conn: Connection, raw: string): void;
}
