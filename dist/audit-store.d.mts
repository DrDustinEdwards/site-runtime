export const AUDIT_KEEP_DAYS: 90;
export const EXPORT_BATCH: 1000;
export const ORPHAN_MINUTES: 15;
/** The Durable Object class a Worker exports (as ToolCallLog) and binds as TOOL_CALL_LOG. */
export class ToolCallLog {
    /**
     * @param {DurableObjectState} state
     * @param {Partial<import("./audit-log.mjs").AuditEnv>} [env]
     */
    constructor(state: DurableObjectState, env?: Partial<import("./audit-log.mjs").AuditEnv>);
    sql: SqlStorage;
    key: Promise<import("./audit-log.mjs").ChainKey>;
    /** @type {Promise<unknown>} */
    tail: Promise<unknown>;
    /** @param {Request} request */
    fetch(request: Request): Promise<Response>;
    /**
     * Writes the `chain-key` row when the key that signed the newest row is not this one (or no row is signed yet).
     * @param {import("./audit-log.mjs").ChainKey} key
     */
    anchor(key: import("./audit-log.mjs").ChainKey): Promise<void>;
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
     * @param {import("./audit-log.mjs").AuditRow | { callId: string, phase: string, caller: string, args: Record<string, unknown> }} row
     * @param {import("./audit-log.mjs").ChainKey} key
     */
    append(row: import("./audit-log.mjs").AuditRow | {
        callId: string;
        phase: string;
        caller: string;
        args: Record<string, unknown>;
    }, key: import("./audit-log.mjs").ChainKey): Promise<void>;
}
