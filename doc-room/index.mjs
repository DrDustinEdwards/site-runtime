// The room for one file: a Durable Object on Cloudflare's y-partyserver, holding the shared working copy
// every editor open on the file is connected to, the people in it, and the comment threads on it. It
// pairs with Capsomer's collab editor (capsomer/collab-editor), whose messages it speaks. Moved from
// Carrel's workers/doc-room.ts (the 2026-11-11 shared-code audit, item 31).
//
// Nobody reaches it but the app's door, which has already checked the person's access and says who they
// are in one header it sets itself (DOC_ROOM_VIEWER_HEADER, `viewerRequest`). So each connection knows
// its person and what they may do:
// - "edit": any change.
// - "suggest": a change is taken only when it changes nothing but suggestions, and touches nobody
//   else's (`suggestOnly`). Anything else is refused and their editor is told to load the room again.
// - Everyone in the room may comment; resolving takes edit, or being the thread's starter.
// What a connection may do is asked of the app again while it is open (`access`), so a person removed,
// disabled or demoted loses it on an editor already open, not only on the next load.
//
// The working copy is kept in the object's own SQLite storage after every change (debounced), so it
// outlives the people in it, hibernation and deploys, and handed to the app's `mirror` (a copy its
// backup carries). Nothing here is a save: a save is the app's, which reads `snapshot`, writes the text
// through its own version check, and tells the room what it wrote (`saved`).
//
// An app extends DocRoom and gives `model` (the document's operations, from Capsomer), `access` (a
// person's access now) and, for comments and the backup copy, `comments` and `mirror`.

import * as decoding from "lib0/decoding";
import { YServer } from "y-partyserver";
import * as Y from "yjs";

import { logEvent } from "../log.mjs";
import { applyComment, readViewer, ROLE_RECHECK_MS, suggestOnly, withinLimit } from "./core.mjs";

export * from "./core.mjs";

const SYNC = 0;
const SYNC_STEP2 = 1;
const SYNC_UPDATE = 2;
const COMMENT_TYPES = new Set(["comment", "comment-edit", "comment-resolve", "comment-delete"]);

/** @typedef {import("./core.d.mts").RoomViewer} RoomViewer */
/** @typedef {import("./core.d.mts").ServerMessage} ServerMessage */
/** @typedef {import("partyserver").Connection} Connection */
/** @typedef {{ viewer?: RoomViewer; checkedAt?: number }} ConnState */

/** @param {Connection} conn */
function viewerOf(conn) {
  return /** @type {ConnState | null} */ (conn.state)?.viewer ?? null;
}

/** @param {import("partyserver").WSMessage} message */
function bytesOf(message) {
  if (typeof message === "string") return null;
  return message instanceof ArrayBuffer
    ? new Uint8Array(message)
    : new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
}

export class DocRoom extends YServer {
  static options = { hibernate: true };
  // A second after typing stops, and at least every five while it goes on.
  static callbackOptions = { debounceWait: 1000, debounceMaxWait: 5000, timeout: 5000 };
  /** Each connection's messages, handled one after another while an access check waits. */
  #inbox = new Map();

  /**
   * The document's operations. An app gives Capsomer collab-editor's.
   * @returns {import("./core.d.mts").DocModel}
   */
  get model() {
    throw new Error("DocRoom: the app's room gives `model`");
  }

  /**
   * What `viewer` may do here now, or null when they may no longer be in the room. Thrown or rejected, the
   * connection is closed and the editor reconnects through the door, which checks again.
   * @param {RoomViewer} _viewer
   * @returns {Promise<Pick<RoomViewer, "access" | "deletesAny"> | null>}
   */
  async access(_viewer) {
    throw new Error("DocRoom: the app's room gives `access`");
  }

  /**
   * Where the comment threads are kept, or null for a room without comments.
   * @returns {import("./core.d.mts").CommentStore | null}
   */
  get comments() {
    return null;
  }

  /**
   * After every store of the working copy: the app's own copy of it, for its backup.
   * @param {{ markdown: string } & import("./core.d.mts").RoomMeta} _state
   * @returns {Promise<void>}
   */
  async mirror(_state) {}

  #store() {
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS room_state (key TEXT PRIMARY KEY, value BLOB)",
    );
  }

  /** @param {string} key */
  #get(key) {
    this.#store();
    const row = this.ctx.storage.sql
      .exec("SELECT value FROM room_state WHERE key = ?", key)
      .toArray()[0];
    return row?.value ?? null;
  }

  /**
   * @param {string} key
   * @param {ArrayBuffer | string} value
   */
  #put(key, value) {
    this.#store();
    this.ctx.storage.sql.exec(
      "INSERT INTO room_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      key,
      value,
    );
  }

  /**
   * Who changed the document since the last save, by person id, with when they last did.
   * @returns {Record<string, string>}
   */
  #contributors() {
    const raw = this.#get("contributors");
    return typeof raw === "string" ? JSON.parse(raw) : {};
  }

  async onLoad() {
    const state = this.#get("doc");
    if (state instanceof ArrayBuffer) Y.applyUpdate(this.document, new Uint8Array(state));
  }

  async onStart() {
    await super.onStart();
    // A change by a person is theirs in the authorship record of the next save.
    this.document.on(
      "update",
      (/** @type {Uint8Array} */ _update, /** @type {unknown} */ origin) => {
        const viewer =
          origin && typeof origin === "object" && "state" in origin
            ? viewerOf(/** @type {Connection} */ (origin))
            : null;
        if (!viewer) return;
        const who = this.#contributors();
        who[String(viewer.id)] = new Date().toISOString();
        this.#put("contributors", JSON.stringify(who));
      },
    );
    // Presence is the server's word: a name on a cursor is the person the door let in.
    this.document.awareness.on(
      "update",
      (/** @type {{ added: number[]; removed: number[] }} */ { added, removed }) => {
        if (added.length || removed.length) queueMicrotask(() => this.#sendPeople());
      },
    );
  }

  async onSave() {
    if (this.model.isSeeded(this.document)) await this.#persist();
  }

  async #persist() {
    this.#put("doc", Y.encodeStateAsUpdate(this.document).slice().buffer);
    await this.mirror({
      markdown: this.model.markdown(this.document),
      ...this.model.readMeta(this.document),
    });
  }

  // ---- the door's calls (RPC), each from a route that has checked the person's access

  /** Where the room stands. `seeded` false: nobody has opened the file since live editing began. */
  async status() {
    await this.__unsafe_ensureInitialized();
    const seeded = this.model.isSeeded(this.document);
    return {
      seeded,
      meta: this.model.readMeta(this.document),
      markdown: seeded ? this.model.markdown(this.document) : "",
      people: [...this.getConnections()].length,
    };
  }

  /**
   * The first load: the file's text as the app has it. Once only.
   * @param {{ markdown: string; version: string | null; saved?: string } & Record<string, unknown>} input
   */
  async seed(input) {
    await this.__unsafe_ensureInitialized();
    if (this.model.isSeeded(this.document)) return false;
    this.model.load(this.document, input);
    await this.#persist();
    return true;
  }

  /**
   * Replaces the whole text for everyone. `unsaved`: the new text is not what the app holds.
   * `expectedVersion`, when given, must still be the room's, so two people asking for the newer version
   * cannot load it twice over someone's new work. A merge also gives `expectedMarkdown`, the text it was
   * merged from, so nothing typed since is replaced, and `saved`, the text it now stands on.
   * @param {{ markdown: string; version: string | null; by: string; expectedVersion?: string | null; unsaved?: boolean; expectedMarkdown?: string; saved?: string }} input
   */
  async replace(input) {
    await this.__unsafe_ensureInitialized();
    const { model, document } = this;
    // A room nobody has opened has no options to read the text with: it starts from `seed`.
    if (!model.isSeeded(document)) return false;
    if (
      input.expectedVersion !== undefined &&
      model.readMeta(document).version !== input.expectedVersion
    )
      return false;
    if (input.expectedMarkdown !== undefined && model.markdown(document) !== input.expectedMarkdown)
      return false;
    // Text nobody has saved yet (an AI draft taken, an import) leaves the last saved text as it was.
    const saved = input.saved ?? (input.unsaved ? model.readMeta(document).saved : undefined);
    model.load(document, {
      markdown: input.markdown,
      version: input.version,
      ...(saved !== undefined ? { saved } : {}),
    });
    await this.#persist();
    this.#broadcast({ t: "replaced", by: input.by });
    return true;
  }

  /** What a save writes now, the version it must be checked against, and who has changed it since the last save. */
  async snapshot() {
    await this.__unsafe_ensureInitialized();
    return {
      seeded: this.model.isSeeded(this.document),
      markdown: this.model.markdown(this.document),
      version: this.model.readMeta(this.document).version,
      at: new Date().toISOString(),
      contributors: Object.keys(this.#contributors()).map(Number),
    };
  }

  /**
   * After a save: the version it made and the text it wrote. Gives back who had a hand in that text
   * (everyone who changed it before the snapshot was taken) and forgets them until they change it again.
   * @param {{ version: string | null; markdown: string; snapshotAt: string }} input
   */
  async saved(input) {
    await this.__unsafe_ensureInitialized();
    this.model.markSaved(this.document, input.version, input.markdown);
    const who = this.#contributors();
    /** @type {number[]} */
    const credited = [];
    for (const [id, at] of Object.entries(who)) {
      if (at > input.snapshotAt) continue;
      credited.push(Number(id));
      delete who[id];
    }
    this.#put("contributors", JSON.stringify(who));
    await this.#persist();
    return credited;
  }

  /**
   * After a write that sent no text (unpublish, unschedule): the new version, taken only when the app
   * still holds the text the room last saved, so unsaved work stays checked against what it started from.
   * @param {{ version: string; source: string }} input
   */
  async rebase(input) {
    await this.__unsafe_ensureInitialized();
    const meta = this.model.readMeta(this.document);
    if (!this.model.isSeeded(this.document) || meta.saved !== input.source) return false;
    this.model.markSaved(this.document, input.version, meta.saved);
    await this.#persist();
    return true;
  }

  // ---- connections

  /**
   * @param {Connection} conn
   * @param {import("partyserver").ConnectionContext} ctx
   */
  onConnect(conn, ctx) {
    const viewer = readViewer(ctx.request);
    if (!viewer || !this.model.isSeeded(this.document)) {
      // Only the door connects, and only to a room its page has loaded.
      conn.close(4403, viewer ? "This file is not open yet. Reload the page." : "Forbidden");
      return;
    }
    // The door looked the access up just now.
    conn.setState((/** @type {unknown} */ prev) => ({
      .../** @type {object | null} */ (prev),
      viewer,
      checkedAt: Date.now(),
    }));
    void super.onConnect(conn, ctx);
    this.#sendPeople();
    this.#sendComments(conn).catch((/** @type {unknown} */ error) =>
      logEvent("room_comments_send_failed", { error: String(error) }, { level: "error" }),
    );
  }

  /**
   * @param {Connection} conn
   * @param {number} code
   * @param {string} reason
   * @param {boolean} wasClean
   */
  onClose(conn, code, reason, wasClean) {
    this.#inbox.delete(conn.id);
    void super.onClose(conn, code, reason, wasClean);
    this.#sendPeople();
  }

  /** @param {Connection} conn */
  isReadOnly(conn) {
    return viewerOf(conn)?.access !== "edit";
  }

  /**
   * @param {Connection} conn
   * @param {import("partyserver").WSMessage} message
   */
  onMessage(conn, message) {
    // Awaiting the access check lets the room's other events in (Rules of Durable Objects, input gates:
    // only the object's own storage holds them back), so one socket's messages are chained in order.
    const next = (this.#inbox.get(conn.id) ?? Promise.resolve())
      .then(() => this.#receive(conn, message))
      .catch((/** @type {unknown} */ error) =>
        logEvent("room_message_failed", { error: String(error) }, { level: "error" }),
      );
    this.#inbox.set(conn.id, next);
    return next;
  }

  /**
   * @param {Connection} conn
   * @param {import("partyserver").WSMessage} message
   */
  async #receive(conn, message) {
    const viewer = await this.#recheck(conn);
    if (!viewer) return;
    const bytes = bytesOf(message);
    // RFC 6455 section 7.4.1 has close code 1009 for a message too big to process, but a closed provider
    // reconnects and sends the same change again, so the room refuses it and the editor loads the room
    // again, dropping it.
    if (!withinLimit(bytes?.byteLength ?? /** @type {string} */ (message).length, viewer.access)) {
      this.#send(conn, {
        t: "refused",
        reason: "That change is too large. Your editor loads the room again.",
      });
      return;
    }
    if (viewer.access === "suggest" && bytes) {
      const decoder = decoding.createDecoder(bytes);
      if (decoding.readVarUint(decoder) === SYNC) {
        const step = decoding.readVarUint(decoder);
        if (step === SYNC_STEP2 || step === SYNC_UPDATE) {
          const update = decoding.readVarUint8Array(decoder);
          if (suggestOnly(this.model, this.document, update, viewer.id))
            Y.applyUpdate(this.document, update, conn);
          else
            this.#send(conn, {
              t: "refused",
              reason: "Only suggestions can be made here. Your editor loads the room again.",
            });
          return;
        }
      }
    }
    this.handleMessage(conn, message);
  }

  /**
   * The connection's viewer with the access they hold now, asked of the app at most once a
   * ROLE_RECHECK_MS, or null after closing a connection whose person has no access left. A demoted person
   * keeps the socket at their new access, so an editor made a suggester has their next plain edit
   * refused and their editor reloads as a suggester. The time of the check rides in the connection's
   * state, which survives hibernation (serializeAttachment, Durable Objects "Use WebSockets").
   * @param {Connection} conn
   * @returns {Promise<RoomViewer | null>}
   */
  async #recheck(conn) {
    const state = /** @type {ConnState | null} */ (conn.state);
    const viewer = state?.viewer;
    if (!viewer) return null;
    if (state.checkedAt !== undefined && Date.now() - state.checkedAt < ROLE_RECHECK_MS)
      return viewer;
    let held;
    try {
      held = await this.access(viewer);
    } catch (error) {
      // Unchecked is not allowed: the editor reconnects through the door, which checks again.
      logEvent("room_role_check_failed", { error: String(error) }, { level: "error" });
      conn.close(1011, "Could not check your access. Reconnecting.");
      return null;
    }
    if (!held || (held.access !== "edit" && held.access !== "suggest")) {
      conn.close(4403, "You no longer have access to this file.");
      return null;
    }
    /** @type {RoomViewer} */
    const now = { id: viewer.id, name: viewer.name, access: held.access };
    if (held.deletesAny) now.deletesAny = true;
    conn.setState((/** @type {unknown} */ prev) => ({
      .../** @type {object | null} */ (prev),
      viewer: now,
      checkedAt: Date.now(),
    }));
    if (now.access !== viewer.access) this.#sendPeople();
    return now;
  }

  /**
   * @param {Connection} conn
   * @param {string} raw
   */
  onCustomMessage(conn, raw) {
    const viewer = viewerOf(conn);
    if (!viewer) return;
    /** @type {import("./core.d.mts").ClientMessage} */
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    // Messages on one socket arrive in order, so the answer comes after every change sent before it.
    if (message?.t === "flush")
      return this.#send(conn, { t: "flushed", n: Number(message.n) || 0 });
    const store = this.comments;
    if (!store || !COMMENT_TYPES.has(message?.t)) return;
    void applyComment(store, viewer, /** @type {import("./core.d.mts").CommentMessage} */ (message))
      .then((refusal) =>
        refusal ? this.#send(conn, { t: "error", message: refusal }) : this.#sendComments(),
      )
      .catch((/** @type {unknown} */ error) => {
        logEvent("room_comment_failed", { error: String(error) }, { level: "error" });
        this.#send(conn, { t: "error", message: "The comment was not saved. Try again." });
      });
  }

  /**
   * @param {Connection} conn
   * @param {ServerMessage} message
   */
  #send(conn, message) {
    this.sendCustomMessage(conn, JSON.stringify(message));
  }

  /** @param {ServerMessage} message */
  #broadcast(message) {
    this.broadcastCustomMessage(JSON.stringify(message));
  }

  #sendPeople() {
    const list = [...this.getConnections()].flatMap((c) => {
      const v = viewerOf(c);
      const clients = (/** @type {{ __ypsAwarenessIds?: number[] } | null} */
      (c.state)?.__ypsAwarenessIds ?? []).slice();
      return v ? [{ conn: c.id, id: v.id, name: v.name, access: v.access, clients }] : [];
    });
    this.#broadcast({ t: "people", people: list });
  }

  /** @param {Connection} [conn] */
  async #sendComments(conn) {
    const store = this.comments;
    if (!store) return;
    const comments = await store.list();
    if (conn) this.#send(conn, { t: "comments", comments });
    else this.#broadcast({ t: "comments", comments });
  }
}
