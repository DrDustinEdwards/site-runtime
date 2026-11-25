/**
 * The MCP servers' tool-call log: an append-only log of every tool call, with the caller, the arguments and the result,
 * and of the door's own events: a sign-in, a scope challenge, a rate-limited request.
 *
 * A Durable Object with synchronous SQLite, one instance for the Worker, reached only from the Worker's own code. It
 * has no UPDATE; its one DELETE is retention, and it removes only rows already copied out and past retention.
 * Read it on the owner page (./owner-page), in the dashboard's Durable Object data view, or in the copies.
 *
 * - EXPORT. `exportAuditLog(env, bucket)`, from the cron, copies the rows not yet copied to R2, one JSON object per
 *   batch at `<prefix><first seq>-<last seq>.json` (`{ previous, keys, verified, rows }`, `previous` the hash of the row
 *   before the first), then marks them copied. Put an object lock on the prefix. Each batch is verified first with the
 *   public key of the bound secret; a failing batch is still copied (it is the evidence) and `auditLogCheck` fails
 *   until a later batch passes.
 * - RETENTION. Rows that are copied and older than `keepDays` (AUDIT_KEEP_DAYS, 90) are deleted; a row never
 *   copied is never deleted.
 * - ALERT. `auditLogCheck(env)` is a /health check (warn and alert): it fails when a `started` row has had no
 *   `finished` row for 15 minutes, when calls in the last hour pass `spikePerHour`, or when rows wait over two days.
 *
 * A refused call is one `refused` row. An allowed call is two: `started` is written before the API is called (the call
 * is refused if that write fails, so no tool runs unlogged), `finished` carries the result (its failure goes to the
 * Worker log). A row carries the caller's audit name (never a credential), the tool, the arguments and result, the
 * server's name and version, the OAuth client id and a correlation id (the `_meta.traceparent` trace id, else fresh). A
 * long string argument is stored as its length and a SHA-256 prefix. Every value is a bound parameter, so a CR or LF is
 * data, never a new row.
 *
 * Tamper evidence: each row's `hash` is SHA-256 over the previous row's hash and its values, and `sig` is an Ed25519
 * signature (RFC 8032) of `hash` under a key derived (HKDF-SHA-256) from the Worker secret `AUDIT_SIGNING_KEY`; `key_id`
 * names the public key. The design follows AWS CloudTrail's log file validation.
 * - The secret is required. Without it no row is written, so no tool runs, and `auditLogCheck` fails. devkit's
 *   worker-deploy mints it (`generated-secrets: AUDIT_SIGNING_KEY`).
 * - KEY ANCHOR. When the newest row was not signed by the current key, the log first writes a `chain-key` row signed
 *   by the new key: `{ from, fromPublicKey, to, publicKey }`, its hash covering the newest row before it; `from: null`
 *   marks the move from the earlier unsigned rows. Rotating is replacing the secret (README, The tool-call log).
 * - VERIFY. `verifyAuditChain(rows, { keys, previous })` checks every hash, then every signature against trusted keys:
 *   given, or named by an anchor signed by a trusted key. An unsigned row passes only before a `from: null` anchor.
 * - Who can forge: nobody without the secret; code deployed to the Worker can read it, which the object-locked copies
 *   bound to rows not yet copied. Neither hash nor signature catches rows cut off the end.
 */

import { sha256Hex, toHex } from "./encoding.mjs";
import { CREDENTIAL_PATTERN, STRIPE_KEY_PATTERN } from "./log.mjs";
import { auditChainKey, trust, verifyAuditChain } from "./audit-chain.mjs";
import { AUDIT_KEEP_DAYS, EXPORT_BATCH, ORPHAN_MINUTES } from "./audit-store.mjs";

export { auditChainKey, verifyAuditChain } from "./audit-chain.mjs";
export { AUDIT_KEEP_DAYS, ToolCallLog } from "./audit-store.mjs";

/**
 * The MCP servers' append-only tool-call log, hash-chained (audit-log.mjs).
 * @typedef {object} AuditEnv
 * @property {{ idFromName(name: string): DurableObjectId; get(id: DurableObjectId): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>; }; }} TOOL_CALL_LOG Untyped or typed as wrangler generates it (`DurableObjectNamespace<ToolCallLog>`): the log reads it through fetch.
 * @property {string} AUDIT_SIGNING_KEY The Worker secret the chain's Ed25519 signing key is derived from, at least 32 characters; required (devkit worker-deploy `generated-secrets`).
 */

/**
 * @typedef {object} AuditRow
 * @property {string} callId One tool call's id, shared by its rows; a fresh one for each other event.
 * @property {| "started" | "finished" | "refused" | "sign-in" | "scope-challenge" | "rate-limited" | "revoked"} phase The event: a tool call's three, or one of the door's own.
 * @property {string} caller A signed-in email or an agent principal, never a credential.
 * @property {string} [tool] The tool, for a tool call or a scope challenge; empty otherwise.
 * @property {Record<string, unknown>} [args]
 * @property {{ isError: boolean; text: string; canceled?: boolean }} [result] `canceled` when the client closed the call (./mcp-server `invokeTool`'s signal).
 * @property {{ name: string; version: string }} [server] The server's serverInfo name and version.
 * @property {string} [clientId] The OAuth client the grant was issued to.
 * @property {string} [clientName] The client's name ("Grok Bot"), so a row says which AI acted, not only its id.
 * @property {string} [correlationId] From `correlationId`: the request's trace id, or a fresh one.
 */

const LONG_STRING = 200;
const EXPORT_BATCHES = 20;
const EXPORT_LATE_DAYS = 2;
const RESULT_CHARS = 1000;

/**
 * The correlation id of one request: its W3C `_meta.traceparent` trace id when well formed, else a fresh one.
 * @param {Record<string, unknown>} [meta]
 */
export function correlationId(meta) {
  const match = /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/.exec(
    String(meta?.traceparent ?? ""),
  );
  if (match && !/^0+$/.test(match[1])) return match[1];
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

/** `text` with the credentials `./log` recognizes cut out (Stripe, Anthropic, GitHub, JWT, Bearer): ASVS 5 v16.2.5. */
const withoutCredentials = (/** @type {string} */ text) =>
  text.replace(STRIPE_KEY_PATTERN, "[key]").replace(CREDENTIAL_PATTERN, "[key]");

/**
 * The arguments as the log stores them: credentials cut out, and a long string, or a structure whose JSON is long,
 * becomes its length and a digest prefix, so one call cannot grow a row without bound.
 * @param {Record<string, unknown>} args
 */
export async function loggedArgs(args) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, value] of Object.entries(args)) {
    const text =
      typeof value === "string"
        ? value
        : value !== null && typeof value === "object"
          ? JSON.stringify(value)
          : null;
    if (text === null) {
      out[key] = value;
    } else if (text.length > LONG_STRING * (typeof value === "string" ? 1 : 5)) {
      out[key] = { chars: text.length, sha256: (await sha256Hex(text)).slice(0, 16) };
    } else {
      // Each string alone: a truncated private key would take the closing quotes of a whole text with it.
      const leaf = (/** @type {string} */ _key, /** @type {unknown} */ v) =>
        typeof v === "string" ? withoutCredentials(v) : v;
      out[key] = JSON.parse(JSON.stringify(value, leaf));
    }
  }
  return out;
}

/**
 * The result as the log stores it: whether it failed, and the start of its text, credentials cut out.
 * @param {{ isError?: boolean, content: Array<{ text: string }> }} output
 */
export function loggedResult(output) {
  const text = output.content.map((c) => c.text).join("\n");
  return {
    isError: output.isError === true,
    text: withoutCredentials(text).slice(0, RESULT_CHARS),
  };
}

/**
 * The log's one instance.
 * @param {Partial<AuditEnv>} env
 * @returns {{ fetch(input: string, init?: RequestInit): Promise<Response> }}
 */
function logStub(env) {
  const ns = /** @type {any} */ (env.TOOL_CALL_LOG);
  if (!ns) throw new Error("the TOOL_CALL_LOG binding is missing");
  return ns.get(ns.idFromName("tool-calls"));
}

/**
 * Copies the rows not yet copied to `bucket`, then deletes copied rows older than `keepDays`. Run it from
 * the cron (./cron's `runJobs`); each run copies up to 20 batches of 1000 rows. Throws when a write fails, so nothing
 * is marked copied that is not. The copy is `{ previous, keys, verified, rows }`; a batch that fails verification is
 * still copied and logged.
 * @param {Partial<AuditEnv>} env
 * @param {{ put(key: string, value: string, options?: unknown): Promise<unknown> }} bucket
 * @param {{ prefix?: string, keepDays?: number }} [options]
 * @returns {Promise<{ exported: number, objects: string[], pruned: number, verified: { ok: true, hashed: number, signed: number } | { ok: false, seq: unknown, reason: string } | null }>}
 */
export async function exportAuditLog(
  env,
  bucket,
  { prefix = "tool-calls/", keepDays = AUDIT_KEEP_DAYS } = {},
) {
  const current = await auditChainKey(env.AUDIT_SIGNING_KEY);
  const stub = logStub(env);
  /** @param {string} path @param {unknown} [body] */
  const call = async (path, body) => {
    const init =
      body === undefined
        ? undefined
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          };
    const response = await stub.fetch(`https://tool-call-log.invalid${path}`, init);
    if (!response.ok) throw new Error(`the tool-call log answered ${response.status} to ${path}`);
    return /** @type {any} */ (await response.json());
  };
  const keys = [...(await trust([current.publicKey], (await call("/anchors")).rows)).values()].map(
    (k) => k.publicKey,
  );
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
    if (!check.ok)
      console.error(
        JSON.stringify({
          audit: "tool-call-log-chain-broken",
          seq: check.seq,
          reason: check.reason,
        }),
      );
    const key = `${prefix}${pad(rows[0].seq)}-${pad(last.seq)}.json`;
    await bucket.put(key, JSON.stringify({ previous, keys, verified: check, rows }), {
      httpMetadata: { contentType: "application/json" },
    });
    objects.push(key);
    exported += rows.length;
    pruned += (
      await call("/exported", {
        seq: last.seq,
        hash: last.hash ?? null,
        keepDays,
        verify: verified,
      })
    ).pruned;
    if (rows.length < EXPORT_BATCH) break;
  }
  if (objects.length === 0)
    pruned += (await call("/exported", { seq: 0, hash: null, keepDays })).pruned;
  return { exported, objects, pruned, verified };
}

/**
 * The tool-call log's /health check (./health's `healthResponse({ checks })`): fails as the header lists, when the
 * last copy's chain check failed, or when AUDIT_SIGNING_KEY is missing or short. The detail gives counts, a seq and a
 * reason only.
 * @param {Partial<AuditEnv>} env
 * @param {{ spikePerHour?: number }} [options]
 * @returns {import("./health.mjs").HealthCheck}
 */
export function auditLogCheck(env, { spikePerHour = 600 } = {}) {
  return {
    name: "tool-call-log",
    level: "warn",
    alert: true,
    run: async () => {
      const response = await logStub(env).fetch("https://tool-call-log.invalid/stats");
      if (!response.ok) return { ok: false, detail: `the log answered ${response.status}` };
      const s =
        /** @type {{ lastHour: number, orphans: number, unexported: number, oldestUnexported: string | null, verify: { ok: boolean, seq?: unknown, reason?: string } | null, keyError: string | null }} */ (
          await response.json()
        );
      const late =
        s.oldestUnexported !== null &&
        Date.now() - Date.parse(s.oldestUnexported) > EXPORT_LATE_DAYS * 86_400_000;
      const wrong = [
        s.keyError ?? "",
        s.verify && !s.verify.ok
          ? `the chain check of the last copy failed at row ${s.verify.seq} (${s.verify.reason})`
          : "",
        s.orphans > 0
          ? `${s.orphans} call(s) with no finished row after ${ORPHAN_MINUTES} minutes`
          : "",
        s.lastHour > spikePerHour ? `${s.lastHour} calls in the last hour` : "",
        late ? `${s.unexported} row(s) not copied for over ${EXPORT_LATE_DAYS} days` : "",
      ].filter(Boolean);
      return wrong.length ? { ok: false, detail: wrong.join("; ") } : true;
    },
  };
}

/**
 * Appends one row. Throws when the binding is missing or the write fails.
 * @param {Partial<AuditEnv>} env
 * @param {AuditRow} row
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
 * Appends a row whose failure changes nothing the caller does: a failed write goes to the Worker log, not a throw.
 * @param {Partial<AuditEnv>} env
 * @param {AuditRow} row
 */
export async function recordAudit(env, row) {
  await appendAudit(env, row).catch((cause) =>
    console.error(
      JSON.stringify({
        audit: "tool-call-log-write-failed",
        phase: row.phase,
        callId: row.callId,
        caller: row.caller,
        tool: row.tool,
        error: String(cause),
      }),
    ),
  );
}
