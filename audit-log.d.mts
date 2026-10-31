/** The MCP servers' append-only tool-call log, hash-chained (audit-log.mjs). */

export interface AuditEnv {
  /** Untyped or typed as wrangler generates it (`DurableObjectNamespace<ToolCallLog>`). */
  TOOL_CALL_LOG: DurableObjectNamespace<any>;
  /** A Worker secret, bound before the first row: the chain is then HMAC-SHA-256 under it, which an editor without it cannot recompute. */
  AUDIT_CHAIN_KEY?: string;
}

export interface AuditRow {
  /** One tool call's id, shared by its rows; a fresh one for each other event. */
  callId: string;
  /** The event: a tool call's three, or one of the door's own. */
  phase: "started" | "finished" | "refused" | "sign-in" | "scope-challenge" | "rate-limited";
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
  /** From `correlationId`: the request's trace id, or a fresh one. */
  correlationId?: string;
}

/**
 * The Durable Object class: rows are inserted and never updated; the one delete is retention, of copied rows only. Adds
 * the newer columns to an older table. Its paths (POST /export and /exported, GET /stats) are for `exportAuditLog` and
 * `auditLogCheck`; any other POST appends.
 */
export declare class ToolCallLog implements DurableObject {
  constructor(state: DurableObjectState, env?: Partial<AuditEnv>);
  fetch(request: Request): Promise<Response>;
}
/**
 * Checks the hash chain over the table's rows in `seq` order, with `AUDIT_CHAIN_KEY` when the log has one; names the
 * first row that fails. `previous` is the hash before the first row, for a copy that starts mid-chain (an export's).
 */
export function verifyAuditChain(
  rows: Array<Record<string, unknown>>,
  key?: string,
  previous?: string | null,
): Promise<{ ok: true; hashed: number } | { ok: false; seq: unknown }>;

/** Days a copied row stays in the log: 90. */
export const AUDIT_KEEP_DAYS: number;
/**
 * Copies the rows not yet copied to `bucket` as `<prefix><first seq>-<last seq>.json` (`{ previous, rows }`; prefix
 * default `tool-calls/`), marks them copied, then deletes copied rows older than `keepDays` (default 90). Up to 20
 * batches of 1000 a run; throws when a write fails. Run it from the cron; lock the prefix in R2.
 */
export function exportAuditLog(
  env: Partial<AuditEnv>,
  bucket: { put(key: string, value: string, options?: unknown): Promise<unknown> },
  options?: { prefix?: string; keepDays?: number },
): Promise<{ exported: number; objects: string[]; pruned: number }>;
/**
 * The log's /health check, "tool-call-log", level warn and alert: fails on a `started` row with no `finished` after 15
 * minutes, on more than `spikePerHour` (600) calls in the last hour, or on rows not copied for over two days.
 */
export function auditLogCheck(env: Partial<AuditEnv>, options?: { spikePerHour?: number }): import("./health.d.mts").HealthCheck;
/** The trace id of a well-formed `_meta.traceparent`, else a fresh 32-hex id. */
export function correlationId(meta?: Record<string, unknown>): string;
/** The arguments as the log stores them: a string over 200 characters becomes its length and a SHA-256 prefix. */
export function loggedArgs(args: Record<string, unknown>): Promise<Record<string, unknown>>;
/** The result as the log stores it: whether it failed, and its first 1000 characters. */
export function loggedResult(output: { isError?: boolean; content: Array<{ text: string }> }): { isError: boolean; text: string };
/** Appends one row; throws when the binding is missing or the write fails. */
export function appendAudit(env: Partial<AuditEnv>, row: AuditRow): Promise<void>;
/** Appends one row; a failure goes to the Worker log instead of throwing. */
export function recordAudit(env: Partial<AuditEnv>, row: AuditRow): Promise<void>;
