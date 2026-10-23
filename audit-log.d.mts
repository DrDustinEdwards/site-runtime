/** The MCP servers' append-only tool-call log (audit-log.mjs). */

export interface AuditEnv {
  TOOL_CALL_LOG: DurableObjectNamespace;
}

export interface AuditRow {
  callId: string;
  phase: "started" | "finished" | "refused";
  /** A signed-in email or an agent principal, never a credential. */
  caller: string;
  tool: string;
  args: Record<string, unknown>;
  result?: { isError: boolean; text: string };
}

/** The Durable Object class: one INSERT, no other write and no read path. */
export declare class ToolCallLog implements DurableObject {
  constructor(state: DurableObjectState);
  fetch(request: Request): Promise<Response>;
}
/** The arguments as the log stores them: a string over 200 characters becomes its length and a SHA-256 prefix. */
export function loggedArgs(args: Record<string, unknown>): Promise<Record<string, unknown>>;
/** The result as the log stores it: whether it failed, and its first 1000 characters. */
export function loggedResult(output: { isError?: boolean; content: Array<{ text: string }> }): { isError: boolean; text: string };
/** Appends one row; throws when the binding is missing or the write fails. */
export function appendAudit(env: Partial<AuditEnv>, row: AuditRow): Promise<void>;
