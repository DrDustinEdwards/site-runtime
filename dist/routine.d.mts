/** @param {string | undefined} url */
export function routineId(url: string | undefined): string | null;
/**
 * @param {string | undefined} url
 * @param {string | undefined} token
 * @returns {RoutineConfig | { missing: string }}
 */
export function routineConfig(url: string | undefined, token: string | undefined): RoutineConfig | {
    missing: string;
};
/**
 * @param {RoutineConfig} config
 * @param {string} text
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<FireResult>}
 */
export function fireRoutine(config: RoutineConfig, text: string, fetcher?: typeof fetch): Promise<FireResult>;
/**
 * `fireOnce`'s store on a D1 table (default `routine_fires`, ROUTINE_FIRES_SQL). `add` is one INSERT ... ON CONFLICT DO
 * NOTHING RETURNING, which D1 runs atomically, so two fires at once cannot both reserve the key.
 * @param {{ prepare(sql: string): { bind(...values: unknown[]): { first(): Promise<any>; run(): Promise<unknown> } } }} db
 * @param {string} [table]
 */
export function d1FireStore(db: {
    prepare(sql: string): {
        bind(...values: unknown[]): {
            first(): Promise<any>;
            run(): Promise<unknown>;
        };
    };
}, table?: string): {
    get: (key: string) => Promise<any>;
    put: (key: string, value: string) => Promise<unknown>;
    delete: (key: string) => Promise<unknown>;
    add: (key: string, value: string) => Promise<boolean>;
};
/**
 * @param {FireStore} store
 * @param {string} jobKey
 * @param {RoutineConfig} config
 * @param {string} text
 * @param {{ fetcher?: typeof fetch, force?: boolean, refireAfterMs?: number, now?: Date }} [options]
 * @returns {Promise<FireOnceResult>}
 */
export function fireOnce(store: FireStore, jobKey: string, config: RoutineConfig, text: string, options?: {
    fetcher?: typeof fetch;
    force?: boolean;
    refireAfterMs?: number;
    now?: Date;
}): Promise<FireOnceResult>;
/** The table `d1FireStore` keeps its records in, as a migration creates it. */
export const ROUTINE_FIRES_SQL: "CREATE TABLE IF NOT EXISTS routine_fires (key TEXT PRIMARY KEY, value TEXT NOT NULL)";
/**
 * Starting a Claude Code routine from a site (routine.mjs).
 */
export type RoutineConfig = {
    url: string;
    token: string;
    routineId: string;
};
export type FireResult = {
    ok: true;
    outcome: "started";
    status: number;
    sessionId: string;
    sessionUrl: string;
} | {
    ok: false;
    outcome: "rate_limited";
    retry: true;
    status: 429;
    retryAfter?: number;
    error: string;
} | {
    ok: false;
    outcome: "unavailable";
    retry: true;
    status: number;
    retryAfter?: number;
    error: string;
} | {
    ok: false;
    outcome: "unreachable";
    retry: true;
    error: string;
} | {
    ok: false;
    outcome: "refused";
    retry: false;
    status: number;
    error: string;
} | {
    ok: false;
    outcome: "unknown";
    retry: false;
    status?: number;
    error: string;
};
/**
 * What `fireOnce` keeps per job key, as JSON. `firing` is a fire in flight; one older than 10 minutes is reported as
 * `unknown` (its worker died mid-fire). `failed` is a sure non-start whose delete failed, and blocks nothing.
 */
export type FireRecord = {
    state: "firing" | "fired" | "unknown" | "failed";
    at: string;
    sessionId?: string | undefined;
    sessionUrl?: string | undefined;
    error?: string | undefined;
};
/**
 * Where `fireOnce` keeps its records: a D1 table or a Durable Object, never KV (eventually consistent, so two fires can
 * both read nothing). Values are JSON strings. `add` is required: it writes only when the key is absent and says
 * whether it did (D1: INSERT ... ON CONFLICT DO NOTHING RETURNING), so two simultaneous fires cannot both reserve.
 */
export type FireStore = {
    get(key: string): Promise<string | null>;
    put(key: string, value: string): Promise<unknown>;
    delete(key: string): Promise<unknown>;
    add(key: string, value: string): Promise<boolean>;
};
export type FireOnceResult = (FireResult & {
    unrecorded?: string;
}) | {
    ok: false;
    outcome: "already_fired";
    retry: false;
    record: FireRecord;
    error: string;
};
