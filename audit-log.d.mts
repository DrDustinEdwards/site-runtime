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
  result?: { isError: boolean; text: string };
  /** The server's serverInfo name and version. */
  server?: { name: string; version: string };
  /** The OAuth client the grant was issued to. */
  clientId?: string;
  /** From `correlationId`: the request's trace id, or a fresh one. */
  correlationId?: string;
}

/** The Durable Object class: one INSERT, no other write and no read path. Adds the newer columns to an older table. */
export declare class ToolCallLog implements DurableObject {
  constructor(state: DurableObjectState, env?: Partial<AuditEnv>);
  fetch(request: Request): Promise<Response>;
}
/** Checks the hash chain over the table's rows in `seq` order, with `AUDIT_CHAIN_KEY` when the log has one; names the first row that fails. */
export function verifyAuditChain(rows: Array<Record<string, unknown>>, key?: string): Promise<{ ok: true; hashed: number } | { ok: false; seq: unknown }>;
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
