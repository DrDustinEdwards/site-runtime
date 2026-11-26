/**
 * The correlation id of one request: its W3C `_meta.traceparent` trace id when well formed, else a fresh one.
 * @param {Record<string, unknown>} [meta]
 */
export function correlationId(meta?: Record<string, unknown>): string;
/**
 * The arguments as the log stores them: credentials cut out, and a long string, or a structure whose JSON is long,
 * becomes its length and a digest prefix, so one call cannot grow a row without bound.
 * @param {Record<string, unknown>} args
 */
export function loggedArgs(args: Record<string, unknown>): Promise<Record<string, unknown>>;
/**
 * The result as the log stores it: whether it failed, and the start of its text, credentials cut out.
 * @param {{ isError?: boolean, content: Array<{ text: string }> }} output
 */
export function loggedResult(output: {
    isError?: boolean;
    content: Array<{
        text: string;
    }>;
}): {
    isError: boolean;
    text: string;
};
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
export function exportAuditLog(env: Partial<AuditEnv>, bucket: {
    put(key: string, value: string, options?: unknown): Promise<unknown>;
}, { prefix, keepDays }?: {
    prefix?: string;
    keepDays?: number;
}): Promise<{
    exported: number;
    objects: string[];
    pruned: number;
    verified: {
        ok: true;
        hashed: number;
        signed: number;
    } | {
        ok: false;
        seq: unknown;
        reason: string;
    } | null;
}>;
/**
 * The tool-call log's /health check (./health's `healthResponse({ checks })`): fails as the header lists, when the
 * last copy's chain check failed, or when AUDIT_SIGNING_KEY is missing or short. The detail gives counts, a seq and a
 * reason only.
 * @param {Partial<AuditEnv>} env
 * @param {{ spikePerHour?: number }} [options]
 * @returns {import("./health.mjs").HealthCheck}
 */
export function auditLogCheck(env: Partial<AuditEnv>, { spikePerHour }?: {
    spikePerHour?: number;
}): import("./health.mjs").HealthCheck;
/**
 * Appends one row. Throws when the binding is missing or the write fails.
 * @param {Partial<AuditEnv>} env
 * @param {AuditRow} row
 */
export function appendAudit(env: Partial<AuditEnv>, row: AuditRow): Promise<void>;
/**
 * Appends a row whose failure changes nothing the caller does: a failed write goes to the Worker log, not a throw.
 * @param {Partial<AuditEnv>} env
 * @param {AuditRow} row
 */
export function recordAudit(env: Partial<AuditEnv>, row: AuditRow): Promise<void>;
/**
 * The MCP servers' append-only tool-call log, hash-chained (audit-log.mjs).
 */
export type AuditEnv = {
    /**
     * Untyped or typed as wrangler generates it (`DurableObjectNamespace<ToolCallLog>`): the log reads it through fetch.
     */
    TOOL_CALL_LOG: {
        idFromName(name: string): DurableObjectId;
        get(id: DurableObjectId): {
            fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
        };
    };
    /**
     * The Worker secret the chain's Ed25519 signing key is derived from, at least 32 characters; required (devkit worker-deploy `generated-secrets`).
     */
    AUDIT_SIGNING_KEY: string;
};
export type AuditRow = {
    /**
     * One tool call's id, shared by its rows; a fresh one for each other event.
     */
    callId: string;
    /**
     * The event: a tool call's three, or one of the door's own.
     */
    phase: "started" | "finished" | "refused" | "sign-in" | "scope-challenge" | "rate-limited" | "revoked";
    /**
     * A signed-in email or an agent principal, never a credential.
     */
    caller: string;
    /**
     * The tool, for a tool call or a scope challenge; empty otherwise.
     */
    tool?: string | undefined;
    args?: Record<string, unknown> | undefined;
    /**
     * `canceled` when the client closed the call (./mcp-server `invokeTool`'s signal).
     */
    result?: {
        isError: boolean;
        text: string;
        canceled?: boolean;
    } | undefined;
    /**
     * The server's serverInfo name and version.
     */
    server?: {
        name: string;
        version: string;
    } | undefined;
    /**
     * The OAuth client the grant was issued to.
     */
    clientId?: string | undefined;
    /**
     * The client's name ("Grok Bot"), so a row says which AI acted, not only its id.
     */
    clientName?: string | undefined;
    /**
     * From `correlationId`: the request's trace id, or a fresh one.
     */
    correlationId?: string | undefined;
};
export type ChainKey = {
    id: string;
    publicKey: string;
    sign(hash: string): Promise<string>;
};
/**
 * What `verifyAuditChain` finds: every row checked, or the first that fails and why.
 */
export type ChainCheck = {
    ok: true;
    hashed: number;
    signed: number;
} | {
    ok: false;
    seq: unknown;
    reason: "hash" | "unsigned" | "unknown key" | "signature" | "key change";
};
export { auditChainKey, verifyAuditChain } from "./audit-chain.mjs";
export { AUDIT_KEEP_DAYS, ToolCallLog } from "./audit-store.mjs";
