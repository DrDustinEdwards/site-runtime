/**
 * The signing key the secret stands for: an Ed25519 key whose seed is HKDF-SHA-256 of the secret, its public key
 * (base64url, raw) and its id (the first 16 hex of the public key's SHA-256). The same secret always gives the same key.
 * @param {string | undefined} secret
 * @returns {Promise<ChainKey>}
 */
export function auditChainKey(secret: string | undefined): Promise<ChainKey>;
/**
 * Checks the chain over rows in `seq` order: every hash, then, with `keys` (trusted public keys, base64url), every
 * signature. Rows from before the hash column are skipped. `previous` is the hash of the row before the first given
 * one (a copy's `previous`). The key changes only at a `chain-key` row whose `from` is the key before; an unsigned row
 * passes only before a `chain-key` row with `from: null`. Without keys only hashes are checked, and `signed` is 0.
 * @param {Array<Record<string, unknown>>} rows
 * @param {{ keys?: readonly string[], previous?: string | null }} [options]
 * @returns {Promise<ChainCheck>}
 */
export function verifyAuditChain(rows: Array<Record<string, unknown>>, { keys, previous }?: {
    keys?: readonly string[];
    previous?: string | null;
}): Promise<ChainCheck>;
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
 * Copies the rows not yet copied to `bucket` (L6), then deletes copied rows older than `keepDays` (L7). Run it from
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
 * The tool-call log's /health check (L8, ./health's `healthResponse({ checks })`): fails as the header lists, when the
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
/** Days a copied row stays in the log (L7). */
export const AUDIT_KEEP_DAYS: 90;
/** The Durable Object class a Worker exports (as ToolCallLog) and binds as TOOL_CALL_LOG. */
export class ToolCallLog {
    /**
     * @param {DurableObjectState} state
     * @param {Partial<AuditEnv>} [env]
     */
    constructor(state: DurableObjectState, env?: Partial<AuditEnv>);
    sql: SqlStorage;
    key: Promise<ChainKey>;
    /** @type {Promise<unknown>} */
    tail: Promise<unknown>;
    /** @param {Request} request */
    fetch(request: Request): Promise<Response>;
    /**
     * Writes the `chain-key` row when the key that signed the newest row is not this one (or no row is signed yet).
     * @param {ChainKey} key
     */
    anchor(key: ChainKey): Promise<void>;
    /**
     * The rows after the last copied one, oldest first, and the hash before them.
     * @param {number} limit
     */
    unexported(limit: number): {
        previous: string | number | ArrayBuffer | null;
        rows: Record<string, SqlStorageValue>[];
    };
    /**
     * Marks the rows through `seq` copied with the copy's check, then deletes the copied rows older than `keepDays`,
     * except the newest row, which the next append chains to. Never moves the mark back.
     * @param {number} seq
     * @param {string | null} hash
     * @param {number} keepDays
     * @param {unknown} verify
     */
    markExported(seq: number, hash: string | null, keepDays: number, verify: unknown): {
        through: number;
        pruned: number;
    };
    /**
     * Up to `limit` rows (at most 100) before the row `before` (0: the newest), newest first: what an owner page shows.
     * @param {number} before
     * @param {number} limit
     */
    recent(before: number, limit: number): Record<string, SqlStorageValue>[];
    /**
     * What the alert reads: calls in the last hour, `started` rows with no `finished` after ORPHAN_MINUTES, the rows
     * waiting for a copy with the oldest one's time, the last copy's chain check, and why the log cannot sign, if it cannot.
     */
    stats(): Promise<{
        lastHour: number;
        orphans: number;
        unexported: number;
        oldestUnexported: string | number | ArrayBuffer | null;
        verify: any;
        keyError: string | null;
    }>;
    /**
     * @param {AuditRow | { callId: string, phase: string, caller: string, args: Record<string, unknown> }} row
     * @param {ChainKey} key
     */
    append(row: AuditRow | {
        callId: string;
        phase: string;
        caller: string;
        args: Record<string, unknown>;
    }, key: ChainKey): Promise<void>;
}
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
export type ChainKey = {
    id: string;
    publicKey: string;
    sign(hash: string): Promise<string>;
};
