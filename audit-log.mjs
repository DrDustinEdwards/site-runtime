/**
 * The MCP servers' tool-call log: an append-only log of every tool call, with the caller, the arguments and the result
 * (ruling mcp-2026-10-10, rule 12.4), and of the door's own events: a sign-in, a scope challenge, a rate-limited request.
 *
 * A Durable Object with synchronous SQLite, one instance for the Worker, reached only from the Worker's own code. It
 * has no UPDATE: a row is written once and never changed. Its one DELETE is retention (L7), and it removes only rows
 * already copied out (L6) and older than the retention period. Read it on the server's owner page (./owner-page, L9),
 * in the Cloudflare dashboard's Durable Object data view, or in the copies.
 *
 * - EXPORT (L6). `exportAuditLog(env, bucket)`, from the Worker's cron, copies the rows not yet copied to R2, one JSON
 *   object per batch at `<prefix><first seq>-<last seq>.json` (`{ previous, rows }`, `previous` the hash of the row
 *   before the first, so `verifyAuditChain(rows, key, previous)` checks each copy on its own). Put an object lock (a
 *   bucket lock rule, as the backups have) on the prefix, so the copy cannot be changed or removed inside its period.
 *   Only then does the log mark the rows copied.
 * - RETENTION (L7). After each copy, rows that are copied and older than `keepDays` (AUDIT_KEEP_DAYS, 90) are deleted.
 *   A row never copied is never deleted, however old.
 * - ALERT (L8). `auditLogCheck(env)` is a /health check, level warn and alert: it fails when a `started` row has had no
 *   `finished` row for 15 minutes (a call ran and the log stopped hearing of it), when calls in the last hour pass
 *   `spikePerHour`, or when rows have waited more than two days for a copy.
 *
 * A refused call is one `refused` row and sent nothing on. An allowed call is two rows: `started` is written before the
 * API is called, and the call is refused if that write fails, so no tool runs unlogged. `finished` carries the result;
 * if that write fails the call has already happened, so the failure goes to the Worker log.
 *
 * A row carries the caller's audit name (a signed-in email or an agent principal, never a credential), the tool, the
 * arguments and the result, the server's name and version, the OAuth client id and a correlation id (the trace id of
 * the request's `_meta.traceparent`, else a fresh one). A long string argument is stored as its length and a SHA-256
 * prefix, enough to prove which bytes were sent without keeping a second copy of the content. Every value is a bound
 * parameter in its own column and the arguments and result are JSON, so a CR or LF in them is data, never a new row.
 *
 * Tamper evidence: each row's `hash` is SHA-256 over the previous row's hash and this row's values, and each row is
 * signed: `sig` is an Ed25519 signature (RFC 8032) of `hash` under a key derived from the Worker secret
 * `AUDIT_SIGNING_KEY` (HKDF-SHA-256, RFC 5869), and `key_id` names the public key that checks it. The design follows AWS
 * CloudTrail's log file validation: a keyless hash chain that never breaks, signatures that name their key's
 * fingerprint, and public keys a verifier keeps after the private one is retired.
 * - The secret is required. Without it no row is written, so no tool runs (a `started` row is refused) and
 *   `auditLogCheck` fails. devkit's worker-deploy mints it (`generated-secrets: AUDIT_SIGNING_KEY`); nobody sees it.
 * - KEY ANCHOR. When the log starts with a key that did not sign its newest row (the first key, or a new one), it first
 *   writes a `chain-key` row, signed by the new key: `{ from, fromPublicKey, to, publicKey }`. Its hash covers the
 *   newest row before it, so the new key vouches for everything before; `from: null` marks the move from the unsigned
 *   rows of before 0.85. Rotating is replacing the secret (README, The tool-call log); the chain goes on unbroken.
 * - VERIFY. `verifyAuditChain(rows, { keys, previous })` checks every hash, then every signature against trusted public
 *   keys. A key is trusted when it is given, or when an anchor signed by a trusted key names it as `fromPublicKey`. A
 *   key changes only at an anchor, and an unsigned row passes only before a `from: null` anchor, so stripping the
 *   signatures and recomputing the hashes fails.
 * - Who can forge: nobody without the secret, which an editor of the table (the dashboard's data view, an edited export)
 *   does not have. Code deployed to the Worker can read it and so could sign false rows; the object-locked copies in R2
 *   bound that to rows not yet copied. Neither the hash nor the signature catches rows cut off the end.
 * - EXPORT CHECK. `exportAuditLog` verifies each batch before it copies it, with the public key of the bound secret,
 *   and writes that key and the result into the copy (`{ previous, key, verified, rows }`), so a copy checks on its
 *   own. A batch that fails is still copied (it is the evidence), and `auditLogCheck` fails until a later batch passes.
 */

import { base64url, fromBase64url, sha256Hex, toHex } from "./encoding.mjs";

const LONG_STRING = 200;
/** Days a copied row stays in the log (L7). */
export const AUDIT_KEEP_DAYS = 90;
const EXPORT_BATCH = 1000;
const EXPORT_BATCHES = 20;
const ORPHAN_MINUTES = 15;
const EXPORT_LATE_DAYS = 2;
const RESULT_CHARS = 1000;
const FIELD_CHARS = 200;
const RECENT_PAGE = 50;
const RECENT_MAX = 100;
/** The shortest AUDIT_SIGNING_KEY accepted, as for ADMIN_IDLE_SECRET: worker-deploy mints 43 characters. */
const KEY_CHARS = 32;
const ANCHOR = "chain-key";

// The columns added after the table first shipped, each nullable, so an existing log migrates in place.
const ADDED = ["server", "version", "client_id", "correlation_id", "hash", "key_id", "sig"];
// The values a row's hash covers, in this order; a signed row's hash also covers its key_id.
const HASHED = ["at", "call_id", "phase", "caller", "tool", "args", "result", "server", "version", "client_id", "correlation_id"];

// PKCS #8 for an Ed25519 private key is this fixed prefix and the 32-byte seed (RFC 8410, section 7).
const PKCS8_ED25519 = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
const KDF_INFO = "site-runtime audit-log chain key v1";

/** @typedef {{ id: string, publicKey: string, sign(hash: string): Promise<string> }} ChainKey */

/** @type {Map<string, Promise<ChainKey>>} */
const derived = new Map();

/**
 * The signing key the secret stands for: an Ed25519 key whose seed is HKDF-SHA-256 of the secret, its public key
 * (base64url, raw) and its id (the first 16 hex of the public key's SHA-256). The same secret always gives the same key.
 * @param {string | undefined} secret
 * @returns {Promise<ChainKey>}
 */
export function auditChainKey(secret) {
  if (typeof secret !== "string" || secret.length < KEY_CHARS) {
    return Promise.reject(new Error(`AUDIT_SIGNING_KEY is not bound or is shorter than ${KEY_CHARS} characters, so the tool-call log writes nothing`));
  }
  let key = derived.get(secret);
  if (!key) {
    key = (async () => {
      const subtle = crypto.subtle;
      const ikm = await subtle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, ["deriveBits"]);
      const seed = new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode(KDF_INFO) }, ikm, 256));
      const pkcs8 = new Uint8Array(PKCS8_ED25519.length + seed.length);
      pkcs8.set(PKCS8_ED25519);
      pkcs8.set(seed, PKCS8_ED25519.length);
      const signer = await subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, true, ["sign"]);
      const publicKey = /** @type {string} */ (/** @type {JsonWebKey} */ (await subtle.exportKey("jwk", signer)).x);
      return {
        id: await keyId(publicKey),
        publicKey,
        sign: async (hash) => base64url(await subtle.sign("Ed25519", signer, new TextEncoder().encode(hash))),
      };
    })();
    derived.set(secret, key);
    key.catch(() => derived.delete(secret));
  }
  return key;
}

/** @param {string} publicKey base64url raw Ed25519 public key */
async function keyId(publicKey) {
  return (await sha256Hex(fromBase64url(publicKey))).slice(0, 16);
}

/** The Durable Object class a Worker exports (as ToolCallLog) and binds as TOOL_CALL_LOG. */
export class ToolCallLog {
  /**
   * @param {DurableObjectState} state
   * @param {Partial<import("./audit-log.d.mts").AuditEnv>} [env]
   */
  constructor(state, env) {
    this.sql = state.storage.sql;
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS calls (" +
        "seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, call_id TEXT NOT NULL, " +
        "phase TEXT NOT NULL, caller TEXT NOT NULL, tool TEXT NOT NULL, args TEXT NOT NULL, result TEXT)",
    );
    const have = new Set(this.sql.exec("PRAGMA table_info(calls)").toArray().map((column) => column.name));
    for (const name of ADDED) if (!have.has(name)) this.sql.exec(`ALTER TABLE calls ADD COLUMN ${name} TEXT`);
    // How far the copy has got: the last copied row's seq and hash, and when; `verify` is the last copy's check.
    this.sql.exec("CREATE TABLE IF NOT EXISTS export_state (id INTEGER PRIMARY KEY CHECK (id = 1), seq INTEGER NOT NULL, hash TEXT, at TEXT NOT NULL)");
    if (!this.sql.exec("PRAGMA table_info(export_state)").toArray().some((column) => column.name === "verify")) {
      this.sql.exec("ALTER TABLE export_state ADD COLUMN verify TEXT");
    }
    // Each key that has signed here, so a rotation's anchor can name the key before it after that key's anchor is pruned.
    this.sql.exec("CREATE TABLE IF NOT EXISTS chain_keys (id TEXT PRIMARY KEY, public_key TEXT NOT NULL, first_at TEXT NOT NULL)");
    // The key is derived and anchored before any row is written; appends wait for it, and each reads the hash the one
    // before it wrote, so they run one at a time.
    this.key = auditChainKey(env?.AUDIT_SIGNING_KEY);
    this.key.catch(() => {}); // a missing key is answered on each append and in stats
    /** @type {Promise<unknown>} */
    this.tail = this.key.then((key) => this.anchor(key));
    this.tail.catch(() => {});
  }

  /** @param {Request} request */
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/stats") return Response.json(await this.stats());
    if (request.method === "GET" && path === "/recent") {
      const query = new URL(request.url).searchParams;
      return Response.json({ rows: this.recent(Number(query.get("before")) || 0, Number(query.get("limit")) || RECENT_PAGE) });
    }
    if (request.method === "GET" && path === "/anchors") {
      return Response.json({ rows: this.sql.exec("SELECT * FROM calls WHERE phase = ? ORDER BY seq", ANCHOR).toArray() });
    }
    if (request.method !== "POST") return new Response("append only", { status: 405 });
    if (path === "/export") return Response.json(this.unexported(Number((await request.json()).limit) || EXPORT_BATCH));
    if (path === "/exported") {
      const { seq, hash, keepDays, verify } = /** @type {{ seq: number, hash: string | null, keepDays?: number, verify?: unknown }} */ (await request.json());
      return Response.json(this.markExported(seq, hash, keepDays ?? AUDIT_KEEP_DAYS, verify));
    }
    const row = /** @type {import("./audit-log.d.mts").AuditRow} */ (await request.json());
    const append = this.tail.then(() => this.key).then((key) => this.append(row, key));
    this.tail = append.catch(() => {});
    await append;
    return new Response(null, { status: 204 });
  }

  /**
   * Writes the `chain-key` row when the key that signed the newest row is not this one (or no row is signed yet).
   * @param {ChainKey} key
   */
  async anchor(key) {
    const newest = this.sql.exec("SELECT key_id FROM calls WHERE hash IS NOT NULL ORDER BY seq DESC LIMIT 1").toArray()[0];
    const from = /** @type {string | null} */ (newest?.key_id ?? null);
    if (from === key.id) return;
    const known = from === null ? undefined : this.sql.exec("SELECT public_key FROM chain_keys WHERE id = ?", from).toArray()[0];
    const fromPublicKey = /** @type {string | null} */ (known?.public_key ?? null);
    this.sql.exec("INSERT OR IGNORE INTO chain_keys (id, public_key, first_at) VALUES (?, ?, ?)", key.id, key.publicKey, new Date().toISOString());
    await this.append({ callId: crypto.randomUUID(), phase: ANCHOR, caller: "site-runtime", args: { from, fromPublicKey, to: key.id, publicKey: key.publicKey } }, key);
  }

  /**
   * The rows after the last copied one, oldest first, and the hash before them.
   * @param {number} limit
   */
  unexported(limit) {
    const mark = this.sql.exec("SELECT seq, hash FROM export_state WHERE id = 1").toArray()[0];
    const rows = this.sql.exec("SELECT * FROM calls WHERE seq > ? ORDER BY seq LIMIT ?", Number(mark?.seq ?? 0), Math.min(Math.max(1, limit), EXPORT_BATCH)).toArray();
    return { previous: mark?.hash ?? null, rows };
  }

  /**
   * Marks the rows through `seq` copied with the copy's check, then deletes the copied rows older than `keepDays`,
   * except the newest row, which the next append chains to. Never moves the mark back.
   * @param {number} seq
   * @param {string | null} hash
   * @param {number} keepDays
   * @param {unknown} verify
   */
  markExported(seq, hash, keepDays, verify) {
    const at = new Date();
    const mark = Number(this.sql.exec("SELECT seq FROM export_state WHERE id = 1").toArray()[0]?.seq ?? 0);
    if (Number.isInteger(seq) && seq > mark) {
      this.sql.exec(
        "INSERT INTO export_state (id, seq, hash, at, verify) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET seq = excluded.seq, hash = excluded.hash, at = excluded.at, verify = excluded.verify",
        seq,
        hash,
        at.toISOString(),
        verify === undefined ? null : JSON.stringify(verify),
      );
    }
    const through = Math.max(mark, Number.isInteger(seq) ? seq : 0);
    const cutoff = new Date(at.getTime() - Math.max(1, keepDays) * 86_400_000).toISOString();
    // The newest row stays whatever its age: the next append chains to it.
    const pruned = this.sql.exec("DELETE FROM calls WHERE seq <= ? AND at < ? AND seq < (SELECT max(seq) FROM calls) RETURNING seq", through, cutoff).toArray().length;
    return { through, pruned };
  }

  /**
   * Up to `limit` rows (at most 100) before the row `before` (0: the newest), newest first: what an owner page shows.
   * @param {number} before
   * @param {number} limit
   */
  recent(before, limit) {
    const n = Math.min(Math.max(1, Math.floor(limit)), RECENT_MAX);
    const columns = "seq, at, call_id, phase, caller, tool, args, result, server, version, client_id, correlation_id";
    return before > 0
      ? this.sql.exec(`SELECT ${columns} FROM calls WHERE seq < ? ORDER BY seq DESC LIMIT ?`, Math.floor(before), n).toArray()
      : this.sql.exec(`SELECT ${columns} FROM calls ORDER BY seq DESC LIMIT ?`, n).toArray();
  }

  /**
   * What the alert reads: calls in the last hour, `started` rows with no `finished` after ORPHAN_MINUTES, the rows
   * waiting for a copy with the oldest one's time, the last copy's chain check, and why the log cannot sign, if it cannot.
   */
  async stats() {
    const now = Date.now();
    const iso = (/** @type {number} */ ms) => new Date(now - ms).toISOString();
    const one = (/** @type {string} */ query, /** @type {unknown[]} */ ...params) => this.sql.exec(query, ...params).toArray()[0] ?? {};
    const state = one("SELECT seq, verify FROM export_state WHERE id = 1");
    const mark = Number(state.seq ?? 0);
    const waiting = one("SELECT count(*) AS n, min(at) AS oldest FROM calls WHERE seq > ?", mark);
    const keyError = await this.key.then(
      () => null,
      (/** @type {unknown} */ cause) => String(/** @type {Error} */ (cause).message ?? cause),
    );
    return {
      lastHour: Number(one("SELECT count(*) AS n FROM calls WHERE phase = 'started' AND at >= ?", iso(3_600_000)).n ?? 0),
      orphans: Number(
        one(
          "SELECT count(*) AS n FROM calls s WHERE s.phase = 'started' AND s.at < ? AND s.at >= ? " +
            "AND NOT EXISTS (SELECT 1 FROM calls f WHERE f.call_id = s.call_id AND f.phase = 'finished')",
          iso(ORPHAN_MINUTES * 60_000),
          iso(86_400_000),
        ).n ?? 0,
      ),
      unexported: Number(waiting.n ?? 0),
      oldestUnexported: waiting.oldest ?? null,
      verify: state.verify ? JSON.parse(String(state.verify)) : null,
      keyError,
    };
  }

  /**
   * @param {import("./audit-log.d.mts").AuditRow | { callId: string, phase: string, caller: string, args: Record<string, unknown> }} row
   * @param {ChainKey} key
   */
  async append(row, key) {
    const field = (/** @type {unknown} */ value) => (value === undefined || value === null ? null : String(value).slice(0, FIELD_CHARS));
    const full = /** @type {import("./audit-log.d.mts").AuditRow} */ (row);
    /** @type {Record<string, string | null>} */
    const values = {
      at: new Date().toISOString(),
      call_id: String(full.callId),
      phase: String(full.phase),
      caller: String(full.caller).slice(0, FIELD_CHARS),
      tool: String(full.tool ?? "").slice(0, FIELD_CHARS),
      args: JSON.stringify(full.args ?? {}),
      result: full.result === undefined ? null : JSON.stringify(full.result),
      server: field(full.server?.name),
      version: field(full.server?.version),
      client_id: field(full.clientId),
      correlation_id: field(full.correlationId),
      key_id: key.id,
    };
    const last = this.sql.exec("SELECT hash FROM calls ORDER BY seq DESC LIMIT 1").toArray()[0];
    const hash = await rowHash(/** @type {string | null} */ (last?.hash ?? null), values);
    const columns = [...HASHED, "key_id"];
    this.sql.exec(
      `INSERT INTO calls (${columns.join(", ")}, hash, sig) VALUES (${columns.map(() => "?").join(", ")}, ?, ?)`,
      ...columns.map((name) => values[name]),
      hash,
      await key.sign(hash),
    );
  }
}

/**
 * A row's link in the chain: SHA-256 of the previous hash and the row's stored values, with its key_id when it is signed.
 * @param {string | null} previous
 * @param {Record<string, unknown>} row
 */
function rowHash(previous, row) {
  const values = HASHED.map((name) => row[name] ?? null);
  if (row.key_id != null) values.push(row.key_id);
  return sha256Hex(`${previous ?? ""}\n${JSON.stringify(values)}`);
}

/** @param {unknown} args */
function anchorArgs(args) {
  try {
    const parsed = JSON.parse(String(args));
    return parsed && typeof parsed === "object" ? /** @type {Record<string, unknown>} */ (parsed) : {};
  } catch {
    return {};
  }
}

/** @param {string} publicKey */
function verifier(publicKey) {
  return crypto.subtle.importKey("raw", fromBase64url(publicKey), { name: "Ed25519" }, false, ["verify"]);
}

/**
 * @param {CryptoKey} key
 * @param {Record<string, unknown>} row
 */
async function signedBy(key, row) {
  try {
    return await crypto.subtle.verify("Ed25519", key, fromBase64url(String(row.sig ?? "")), new TextEncoder().encode(String(row.hash)));
  } catch {
    return false;
  }
}

/**
 * The keys trusted for `rows`: each given public key, then each key a trusted key's `chain-key` row names as
 * `fromPublicKey`, until no more are added. Maps a key id to its public key and verifying key.
 * @param {readonly string[]} publicKeys
 * @param {Array<Record<string, unknown>>} rows
 */
async function trust(publicKeys, rows) {
  /** @type {Map<string, { publicKey: string, key: CryptoKey }>} */
  const trusted = new Map();
  for (const publicKey of publicKeys) trusted.set(await keyId(publicKey), { publicKey, key: await verifier(publicKey) });
  const anchors = rows.filter((row) => row.phase === ANCHOR && row.key_id != null);
  for (let grew = trusted.size > 0; grew; ) {
    grew = false;
    for (const row of anchors) {
      const args = anchorArgs(row.args);
      const signer = trusted.get(String(row.key_id));
      if (!signer || typeof args.fromPublicKey !== "string" || typeof args.from !== "string" || trusted.has(args.from)) continue;
      if (!(await signedBy(signer.key, row)) || (await keyId(args.fromPublicKey)) !== args.from) continue;
      trusted.set(args.from, { publicKey: args.fromPublicKey, key: await verifier(args.fromPublicKey) });
      grew = true;
    }
  }
  return trusted;
}

/**
 * Checks the chain over rows as the table holds them, in `seq` order (an export from the data view, or a copy's rows):
 * every hash, then, with `keys`, every signature. Rows from before the hash column are skipped. `previous` is the hash
 * of the row before the first given one, for a slice that starts mid-chain (a copy's `previous`).
 *
 * With `keys` (trusted public keys, base64url): a signed row must verify under a trusted key; a key is trusted when it
 * is given or when a `chain-key` row signed by a trusted key names it as `fromPublicKey`; the key changes only at a
 * `chain-key` row whose `from` is the key before; and an unsigned row passes only before a `chain-key` row with
 * `from: null`. Without keys only the hashes are checked, and `signed` is 0.
 * @param {Array<Record<string, unknown>>} rows
 * @param {{ keys?: readonly string[], previous?: string | null }} [options]
 * @returns {Promise<{ ok: true, hashed: number, signed: number } | { ok: false, seq: unknown, reason: string }>}
 */
export async function verifyAuditChain(rows, { keys = [], previous = null } = {}) {
  const trusted = await trust(keys, rows);
  const lastUnsignedAllowed = rows.findIndex((row) => row.phase === ANCHOR && row.key_id != null && anchorArgs(row.args).from === null);
  const checkSignatures = keys.length > 0;
  /** @type {string | null} */
  let link = previous;
  /** @type {string | undefined} the key of the signed row before; undefined until one is seen */
  let lastKey;
  let unsignedBefore = false;
  let hashed = 0;
  let signed = 0;
  for (const [index, row] of rows.entries()) {
    if (row.hash == null && link === null) continue;
    if (row.hash !== (await rowHash(link, row))) return { ok: false, seq: row.seq, reason: "hash" };
    if (checkSignatures) {
      if (row.key_id == null) {
        if (lastKey !== undefined || !(index < lastUnsignedAllowed)) return { ok: false, seq: row.seq, reason: "unsigned" };
        unsignedBefore = true;
      } else {
        const id = String(row.key_id);
        const key = trusted.get(id);
        if (!key) return { ok: false, seq: row.seq, reason: "unknown key" };
        if (!(await signedBy(key.key, row))) return { ok: false, seq: row.seq, reason: "signature" };
        const args = row.phase === ANCHOR ? anchorArgs(row.args) : null;
        if (args && args.to !== id) return { ok: false, seq: row.seq, reason: "key change" };
        const before = lastKey ?? (unsignedBefore ? null : undefined);
        // A slice that starts on a signed row may start with any trusted key; after that, only an anchor changes it.
        if (before !== undefined && before !== id && args?.from !== before) return { ok: false, seq: row.seq, reason: "key change" };
        lastKey = id;
        signed++;
      }
    }
    link = /** @type {string} */ (row.hash);
    hashed++;
  }
  return { ok: true, hashed, signed };
}

/**
 * The correlation id of one request: the trace id of its W3C `_meta.traceparent` when that is well formed, else a
 * fresh id of the same shape, so the log and a tracing system name a call alike.
 * @param {Record<string, unknown> | undefined} [meta]
 */
export function correlationId(meta) {
  const match = /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/.exec(String(meta?.traceparent ?? ""));
  if (match && !/^0+$/.test(match[1])) return match[1];
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * The arguments as the log stores them: long strings become their length and a digest prefix.
 * @param {Record<string, unknown>} args
 */
export async function loggedArgs(args) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, value] of Object.entries(args)) {
    out[key] = typeof value === "string" && value.length > LONG_STRING ? { chars: value.length, sha256: (await sha256Hex(value)).slice(0, 16) } : value;
  }
  return out;
}

/**
 * The result as the log stores it: whether it failed, and the start of its text.
 * @param {{ isError?: boolean, content: Array<{ text: string }> }} output
 */
export function loggedResult(output) {
  const text = output.content.map((c) => c.text).join("\n");
  return { isError: output.isError === true, text: text.slice(0, RESULT_CHARS) };
}

/**
 * The log's one instance.
 * @param {Partial<import("./audit-log.d.mts").AuditEnv>} env
 * @returns {{ fetch(input: string, init?: RequestInit): Promise<Response> }}
 */
function logStub(env) {
  const ns = /** @type {any} */ (env.TOOL_CALL_LOG);
  if (!ns) throw new Error("the TOOL_CALL_LOG binding is missing");
  return ns.get(ns.idFromName("tool-calls"));
}

/**
 * Copies the rows not yet copied to `bucket` (L6), then deletes copied rows older than `keepDays` (L7). Run it from the
 * Worker's cron (./cron's `runJobs`); each run copies up to 20 batches of 1000 rows and the next run goes on. Throws
 * when a write fails, so the job is recorded as failed and nothing is marked copied that is not.
 *
 * Each batch is checked first (`verifyAuditChain`) with the bound secret's public key and the keys its anchors vouch
 * for, and the copy carries those keys and the result: `{ previous, keys, verified, rows }`. A batch that fails is still
 * copied, since it is the evidence; the failure goes to the Worker log, and `auditLogCheck` fails until a later run passes.
 * @param {Partial<import("./audit-log.d.mts").AuditEnv>} env
 * @param {{ put(key: string, value: string, options?: unknown): Promise<unknown> }} bucket
 * @param {{ prefix?: string, keepDays?: number }} [options]
 * @returns {Promise<{ exported: number, objects: string[], pruned: number, verified: { ok: true, hashed: number, signed: number } | { ok: false, seq: unknown, reason: string } | null }>}
 */
export async function exportAuditLog(env, bucket, { prefix = "tool-calls/", keepDays = AUDIT_KEEP_DAYS } = {}) {
  const current = await auditChainKey(env.AUDIT_SIGNING_KEY);
  const stub = logStub(env);
  const call = async (/** @type {string} */ path, /** @type {unknown} */ body = undefined) => {
    const init = body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
    const response = await stub.fetch(`https://tool-call-log.invalid${path}`, init);
    if (!response.ok) throw new Error(`the tool-call log answered ${response.status} to ${path}`);
    return /** @type {any} */ (await response.json());
  };
  // Every key the current one vouches for, through the anchors still in the table.
  const keys = [...(await trust([current.publicKey], (await call("/anchors")).rows)).values()].map((k) => k.publicKey);
  const pad = (/** @type {unknown} */ seq) => String(seq).padStart(12, "0");
  /** @type {string[]} */
  const objects = [];
  let exported = 0;
  let pruned = 0;
  /** @type {Awaited<ReturnType<typeof verifyAuditChain>> | null} */
  let verified = null;
  for (let batch = 0; batch < EXPORT_BATCHES; batch++) {
    const { previous, rows } = await call("/export", { limit: EXPORT_BATCH });
    const last = rows.at(-1);
    if (!last) break;
    const check = await verifyAuditChain(rows, { keys, previous });
    // The run's result is its first failure, or the last pass.
    if (verified === null || verified.ok) verified = check;
    if (!check.ok) console.error(JSON.stringify({ audit: "tool-call-log-chain-broken", seq: check.seq, reason: check.reason }));
    const key = `${prefix}${pad(rows[0].seq)}-${pad(last.seq)}.json`;
    await bucket.put(key, JSON.stringify({ previous, keys, verified: check, rows }), { httpMetadata: { contentType: "application/json" } });
    objects.push(key);
    exported += rows.length;
    pruned += (await call("/exported", { seq: last.seq, hash: last.hash ?? null, keepDays, verify: verified })).pruned;
    if (rows.length < EXPORT_BATCH) break;
  }
  if (objects.length === 0) pruned += (await call("/exported", { seq: 0, hash: null, keepDays })).pruned;
  return { exported, objects, pruned, verified };
}

/**
 * The tool-call log's /health check (L8, ./health's `healthResponse({ checks })`), level warn and alert: fails when a
 * call's `finished` row is 15 minutes late, when calls in the last hour pass `spikePerHour`, when rows have waited
 * more than two days for a copy, when the last copy's chain check failed, or when AUDIT_SIGNING_KEY is missing or short
 * (then nothing is logged and every tool call is refused). The detail gives counts, a seq and a reason only.
 * @param {Partial<import("./audit-log.d.mts").AuditEnv>} env
 * @param {{ spikePerHour?: number }} [options]
 * @returns {import("./health.d.mts").HealthCheck}
 */
export function auditLogCheck(env, { spikePerHour = 600 } = {}) {
  return {
    name: "tool-call-log",
    level: "warn",
    alert: true,
    run: async () => {
      const response = await logStub(env).fetch("https://tool-call-log.invalid/stats");
      if (!response.ok) return { ok: false, detail: `the log answered ${response.status}` };
      const s = /** @type {{ lastHour: number, orphans: number, unexported: number, oldestUnexported: string | null, verify: { ok: boolean, seq?: unknown, reason?: string } | null, keyError: string | null }} */ (await response.json());
      const late = s.oldestUnexported !== null && Date.now() - Date.parse(s.oldestUnexported) > EXPORT_LATE_DAYS * 86_400_000;
      const wrong = [
        s.keyError ?? "",
        s.verify && !s.verify.ok ? `the chain check of the last copy failed at row ${s.verify.seq} (${s.verify.reason})` : "",
        s.orphans > 0 ? `${s.orphans} call(s) with no finished row after ${ORPHAN_MINUTES} minutes` : "",
        s.lastHour > spikePerHour ? `${s.lastHour} calls in the last hour` : "",
        late ? `${s.unexported} row(s) not copied for over ${EXPORT_LATE_DAYS} days` : "",
      ].filter(Boolean);
      return wrong.length ? { ok: false, detail: wrong.join("; ") } : true;
    },
  };
}

/**
 * Appends one row. Throws when the binding is missing or the write fails, so the caller decides: a failed `started`
 * refuses the call, a failed `finished` is reported to the Worker log.
 * @param {Partial<import("./audit-log.d.mts").AuditEnv>} env
 * @param {import("./audit-log.d.mts").AuditRow} row
 */
export async function appendAudit(env, row) {
  const response = await logStub(env).fetch("https://tool-call-log.invalid/append", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(row),
  });
  if (response.status !== 204) throw new Error(`the tool-call log answered ${response.status}`);
}

/**
 * Appends a row whose failure changes nothing the caller does (a refusal, a sign-in, a challenge, a rate limit): a
 * failed write goes to the Worker log instead of throwing.
 * @param {Partial<import("./audit-log.d.mts").AuditEnv>} env
 * @param {import("./audit-log.d.mts").AuditRow} row
 */
export async function recordAudit(env, row) {
  await appendAudit(env, row).catch((cause) =>
    console.error(JSON.stringify({ audit: "tool-call-log-write-failed", phase: row.phase, callId: row.callId, caller: row.caller, tool: row.tool, error: String(cause) })),
  );
}
