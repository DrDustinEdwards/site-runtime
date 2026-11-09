/** The MCP servers' append-only tool-call log, hash-chained (audit-log.mjs). */

export interface AuditEnv {
  /** Untyped or typed as wrangler generates it (`DurableObjectNamespace<ToolCallLog>`): the log reads it through fetch. */
  TOOL_CALL_LOG: {
    idFromName(name: string): DurableObjectId;
    get(id: DurableObjectId): {
      fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
    };
  };
  /** The Worker secret the chain's Ed25519 signing key is derived from, at least 32 characters; required (devkit worker-deploy `generated-secrets`). */
  AUDIT_SIGNING_KEY: string;
}

export interface AuditRow {
  /** One tool call's id, shared by its rows; a fresh one for each other event. */
  callId: string;
  /** The event: a tool call's three, or one of the door's own. */
  phase:
    | "started"
    | "finished"
    | "refused"
    | "sign-in"
    | "scope-challenge"
    | "rate-limited"
    | "revoked";
  /** A signed-in email or an agent principal, never a credential. */
  caller: string;
  /** The tool, for a tool call or a scope challenge; empty otherwise. */
  tool?: string;
  args?: Record<string, unknown>;
  /** `canceled` when the client closed the call (./mcp-server `invokeTool`'s signal). */
  result?: { isError: boolean; text: string; canceled?: boolean };
  /** The server's serverInfo name and version. */
  server?: { name: string; version: string };
  /** The OAuth client the grant was issued to. */
  clientId?: string;
  /** The client's name ("Grok Bot"), so a row says which AI acted, not only its id. */
  clientName?: string;
  /** From `correlationId`: the request's trace id, or a fresh one. */
  correlationId?: string;
}

/** The chain's signing key for a secret: its id (16 hex of the public key's SHA-256) and raw Ed25519 public key, base64url. Rejects a secret under 32 characters. */
export function auditChainKey(
  secret: string | undefined,
): Promise<{ id: string; publicKey: string; sign(hash: string): Promise<string> }>;

/** What `verifyAuditChain` finds: every row checked, or the first that fails and why. */
export type ChainCheck =
  | { ok: true; hashed: number; signed: number }
  | {
      ok: false;
      seq: unknown;
      reason: "hash" | "unsigned" | "unknown key" | "signature" | "key change";
    };

/**
 * The Durable Object class: rows are inserted and never updated; the one delete is retention, of copied rows only. Adds
 * the newer columns to an older table, and writes a `chain-key` anchor when it starts under a key that did not sign its
 * newest row. Its paths (POST /export and /exported, GET /stats, /recent and /anchors) are for `exportAuditLog`,
 * `auditLogCheck` and ./owner-page's `readAuditLog`; any other POST appends.
 */
export declare class ToolCallLog implements DurableObject {
  constructor(state: DurableObjectState, env?: Partial<AuditEnv>);
  fetch(request: Request): Promise<Response>;
}
/**
 * Checks the chain over rows in `seq` order: every hash, and with trusted public `keys` every signature (a key is also
 * trusted when an anchor signed by a trusted key names it). `previous` is the hash before the first row, for a slice
 * that starts mid-chain (a copy's). Without keys only the hashes are checked.
 */
export function verifyAuditChain(
  rows: Array<Record<string, unknown>>,
  options?: { keys?: readonly string[]; previous?: string | null },
): Promise<ChainCheck>;

/** Days a copied row stays in the log: 90. */
export const AUDIT_KEEP_DAYS: number;
/**
 * Checks each batch not yet copied, copies it to `bucket` as `<prefix><first seq>-<last seq>.json` (`{ previous, keys,
 * verified, rows }`; prefix default `tool-calls/`), marks it copied, then deletes copied rows older than `keepDays`
 * (default 90). Up to 20 batches of 1000 a run; throws when a write fails or AUDIT_SIGNING_KEY is missing. `verified` is
 * the run's first failed check, else its last pass. Run it from the cron; lock the prefix in R2.
 */
export function exportAuditLog(
  env: Partial<AuditEnv>,
  bucket: { put(key: string, value: string, options?: unknown): Promise<unknown> },
  options?: { prefix?: string; keepDays?: number },
): Promise<{ exported: number; objects: string[]; pruned: number; verified: ChainCheck | null }>;
/**
 * The log's /health check, "tool-call-log", level warn and alert: fails on a `started` row with no `finished` after 15
 * minutes, on more than `spikePerHour` (600) calls in the last hour, on rows not copied for over two days, on a failed
 * chain check of the last copy, or on a missing or short AUDIT_SIGNING_KEY.
 */
export function auditLogCheck(
  env: Partial<AuditEnv>,
  options?: { spikePerHour?: number },
): import("./health.d.mts").HealthCheck;
/** The trace id of a well-formed `_meta.traceparent`, else a fresh 32-hex id. */
export function correlationId(meta?: Record<string, unknown>): string;
/** The arguments as the log stores them: a string over 200 characters becomes its length and a SHA-256 prefix. */
export function loggedArgs(args: Record<string, unknown>): Promise<Record<string, unknown>>;
/** The result as the log stores it: whether it failed, and its first 1000 characters. */
export function loggedResult(output: { isError?: boolean; content: Array<{ text: string }> }): {
  isError: boolean;
  text: string;
};
/** Appends one row; throws when the binding is missing or the write fails. */
export function appendAudit(env: Partial<AuditEnv>, row: AuditRow): Promise<void>;
/** Appends one row; a failure goes to the Worker log instead of throwing. */
export function recordAudit(env: Partial<AuditEnv>, row: AuditRow): Promise<void>;
