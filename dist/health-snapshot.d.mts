/**
 * The tile a page shows. Fails to "missing" in every uncertain direction, a future timestamp included: this is untyped
 * KV JSON, and a cached page presenting a bad value as a verdict would be lying.
 * @param {unknown} snapshot the parsed KV value, or null
 * @param {number} nowMs
 * @param {{ everyMinutes?: number }} [options]
 */
export function healthTile(snapshot: unknown, nowMs: number, { everyMinutes }?: {
    everyMinutes?: number;
}): {
    state: string;
    ok?: undefined;
    total?: undefined;
    failed?: undefined;
    readAt?: undefined;
    ageSeconds?: undefined;
    checks?: undefined;
} | {
    state: string;
    ok: boolean;
    total: number;
    failed: number;
    readAt: string;
    ageSeconds: number;
    checks: {
        name: any;
        status: any;
    }[];
};
/**
 * Each check's name and status, as public as /health itself, and no detail. Null for a body that is not a /health
 * answer, so a refusal or an error page is never stored as a verdict.
 * @param {unknown} body the parsed /health body
 * @param {string} readAt an ISO time
 */
export function snapshotFromBody(body: unknown, readAt: string): {
    ok: boolean;
    total: number;
    failed: number;
    readAt: string;
    checks: {
        name: any;
        status: "warn" | "pass" | "fail";
    }[];
} | null;
/**
 * The one writer, for the site's scheduled job: run the site's /health answer and store its checks. Throws when nothing
 * was stored, so runJobs records the job failed and /health's cron check names it.
 * @param {{ kv: KVNamespace, answer: () => Promise<Response>, now?: Date, key?: string }} options
 */
export function storeHealthSnapshot({ kv, answer, now, key, }: {
    kv: KVNamespace;
    answer: () => Promise<Response>;
    now?: Date;
    key?: string;
}): Promise<void>;
/**
 * The tile for a page. A failed KV read is `unreadable` (and logged), not `missing`: the page renders whatever KV is
 * doing, but a failed read is not the same fact as no snapshot.
 * @param {{ kv: KVNamespace, now?: number, everyMinutes?: number, key?: string }} options
 */
export function readHealthTile({ kv, now, everyMinutes, key, }: {
    kv: KVNamespace;
    now?: number;
    everyMinutes?: number;
    key?: string;
}): Promise<{
    state: string;
    ok?: undefined;
    total?: undefined;
    failed?: undefined;
    readAt?: undefined;
    ageSeconds?: undefined;
    checks?: undefined;
} | {
    state: string;
    ok: boolean;
    total: number;
    failed: number;
    readAt: string;
    ageSeconds: number;
    checks: {
        name: any;
        status: any;
    }[];
}>;
/**
 * /health's verdict in KV for a page's tile (health-snapshot.mjs): one writer, the site's scheduled job.
 * @typedef {object} SnapshotCheck
 * @property {string} name
 * @property {"pass" | "warn" | "fail"} status
 */
/**
 * @typedef {object} HealthSnapshot
 * @property {boolean} ok
 * @property {number} total
 * @property {number} failed
 * @property {string} readAt
 * @property {SnapshotCheck[]} checks
 */
/**
 * @typedef {| ({ state: "fresh" | "stale"; ageSeconds: number } & HealthSnapshot)
 * | { state: "missing" }
 * | { state: "unreadable" }} HealthTile
 */
/** One key, not a prefix: a prefix would invite a second writer. */
export const HEALTH_SNAPSHOT_KEY: "health:snapshot";
/** The job's usual interval in minutes; a snapshot is stale after three of them (a Cron Trigger is best effort). */
export const HEALTH_SNAPSHOT_EVERY_MINUTES: 15;
/**
 * /health's verdict in KV for a page's tile (health-snapshot.mjs): one writer, the site's scheduled job.
 */
export type SnapshotCheck = {
    name: string;
    status: "pass" | "warn" | "fail";
};
export type HealthSnapshot = {
    ok: boolean;
    total: number;
    failed: number;
    readAt: string;
    checks: SnapshotCheck[];
};
export type HealthTile = ({
    state: "fresh" | "stale";
    ageSeconds: number;
} & HealthSnapshot) | {
    state: "missing";
} | {
    state: "unreadable";
};
