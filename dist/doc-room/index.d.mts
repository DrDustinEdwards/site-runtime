export * from "./core.mjs";
declare const DocRoom_base: typeof import("partyserver").Server & import("y-partyserver").YjsStatic & (new (...args: any[]) => import("y-partyserver").YjsInstance);
/** @import { RoomViewer, ServerMessage, BroughtThread, ReplaceInput, ConnState } from "./core.mjs" */
/** @typedef {import("partyserver").Connection} Connection */
/**
 * The co-editing room: a site's Durable Object extends it and fills in `access`, `comments` and `mirror`.
 * @template {Cloudflare.Env} [E=Cloudflare.Env]
 * @extends {YServer<E>}
 */
export class DocRoom<E extends Cloudflare.Env = Cloudflare.Env> extends DocRoom_base {
    static options: {
        hibernate: boolean;
    };
    static callbackOptions: {
        debounceWait: number;
        debounceMaxWait: number;
        timeout: number;
    };
    constructor(ctx: DurableObjectState, env: E);
    /**
     * The document's operations (Capsomer collab-editor's).
     * @returns {import("./core.mjs").DocModel}
     */
    get model(): import("./core.mjs").DocModel;
    /**
     * What `viewer` may do now, or null when no longer in the room. Thrown, the connection closes and reconnects through the door.
     * @param {RoomViewer} _viewer
     * @returns {Promise<Pick<RoomViewer, "access" | "deletesAny"> | null>}
     */
    access(_viewer: RoomViewer): Promise<Pick<RoomViewer, "access" | "deletesAny"> | null>;
    /**
     * Where the comment threads are kept, or null for a room without comments.
     * @returns {import("./core.mjs").CommentStore | null}
     */
    get comments(): import("./core.mjs").CommentStore | null;
    /**
     * After every store: the app's own copy of the working copy, for its backup.
     * @param {{ markdown: string } & import("./core.mjs").RoomMeta} _state
     * @returns {Promise<void>}
     */
    mirror(_state: {
        markdown: string;
    } & import("./core.mjs").RoomMeta): Promise<void>;
    onLoad(): Promise<void>;
    onStart(): Promise<void>;
    /** Where the room stands. `seeded` false: nobody has opened the file since live editing began. */
    status(): Promise<{
        seeded: boolean;
        meta: import("./core.mjs").RoomMeta;
        markdown: string;
        people: number;
    }>;
    /**
     * The first load: the file's text as the app has it. Once only.
     * @param {{ markdown: string; version: string | null; saved?: string } & Record<string, unknown>} input
     */
    seed(input: {
        markdown: string;
        version: string | null;
        saved?: string;
    } & Record<string, unknown>): Promise<boolean>;
    /**
     * Replaces the whole text for everyone. `unsaved`: the new text is not what the app holds.
     * `expectedVersion` and `expectedMarkdown` refuse the replace when the room has moved on.
     * @param {ReplaceInput} input
     */
    replace(input: ReplaceInput): Promise<boolean>;
    /**
     * The working copy as the editor's JSON text, suggestions and all. Text, because RPC refuses Yjs's non-plain objects.
     */
    json(): Promise<string | null>;
    /** What a save writes now, the version it must be checked against, and who has changed it since the last save. */
    snapshot(): Promise<{
        seeded: boolean;
        markdown: string;
        version: string | null;
        at: string;
        contributors: number[];
    }>;
    /**
     * After a save: the version it made and the text it wrote. Returns who changed it before the snapshot, and forgets them.
     * @param {{ version: string | null; markdown: string; snapshotAt: string }} input
     */
    saved(input: {
        version: string | null;
        markdown: string;
        snapshotAt: string;
    }): Promise<number[]>;
    /**
     * After a write that sent no text (unpublish, unschedule): the new version, taken only when the app still holds the room's last saved text.
     * @param {{ version: string; source: string }} input
     */
    rebase(input: {
        version: string;
        source: string;
    }): Promise<boolean>;
    /**
     * @param {Connection} conn
     * @param {import("partyserver").ConnectionContext} ctx
     */
    onConnect(conn: Connection, ctx: import("partyserver").ConnectionContext): void;
    /**
     * @param {Connection} conn
     * @param {number} code
     * @param {string} reason
     * @param {boolean} wasClean
     */
    onClose(conn: Connection, code: number, reason: string, wasClean: boolean): void;
    /**
     * @param {Connection} conn
     * @param {import("partyserver").WSMessage} message
     */
    onMessage(conn: Connection, message: import("partyserver").WSMessage): any;
    #private;
}
export type Connection = import("partyserver").Connection;
import type { RoomViewer } from "./core.mjs";
import type { ReplaceInput } from "./core.mjs";
