/**
 * @typedef {{ name: string, level?: "fail" | "warn", alert?: boolean, run: () => Promise<unknown> }} HealthCheck
 * @typedef {Array<{ name: string, everyMinutes: number | null }>} CronJobs
 * @typedef {{ name: string, status: "pass" | "warn" | "fail", detail?: string, alert?: true }} CheckResult
 */
/**
 * @param {{ ping?: () => Promise<unknown>, backup?: () => Promise<unknown>, sha?: string, checks?: HealthCheck[], backupTtlMs?: number, checkTimeoutMs?: number, now?: Date, cache?: { match(key: string): Promise<Response | undefined>, put(key: string, response: Response): Promise<void> } }} probe
 * @returns {Promise<Response>}
 */
export function healthResponse({ ping, backup, sha, checks, backupTtlMs, checkTimeoutMs, now, cache, }?: {
    ping?: () => Promise<unknown>;
    backup?: () => Promise<unknown>;
    sha?: string;
    checks?: HealthCheck[];
    backupTtlMs?: number;
    checkTimeoutMs?: number;
    now?: Date;
    cache?: {
        match(key: string): Promise<Response | undefined>;
        put(key: string, response: Response): Promise<void>;
    };
}): Promise<Response>;
/**
 * The /health every site with a D1 database answers: `healthResponse` with `ping` on `env.DB`, `sha` from DEPLOY_SHA,
 * and the "cron" check over `jobs` since the deploy, after the site's own `checks`. `jobs` may be a function (sync or
 * async) for a site whose registered jobs depend on its database, such as ones its settings switch off.
 * @param {{ DB: { prepare(sql: string): { first(): Promise<unknown> } } }} env
 * @param {{ backup?: () => Promise<unknown>, checks?: HealthCheck[], jobs: CronJobs | (() => CronJobs | Promise<CronJobs>) }} site
 * @returns {Promise<Response>}
 */
export function siteHealthResponse(env: {
    DB: {
        prepare(sql: string): {
            first(): Promise<unknown>;
        };
    };
}, { backup, checks, jobs }: {
    backup?: () => Promise<unknown>;
    checks?: HealthCheck[];
    jobs: CronJobs | (() => CronJobs | Promise<CronJobs>);
}): Promise<Response>;
/**
 * A check that an R2 bucket answers: a `head` of a fixed key, where null (no such object) passes and a throw fails.
 * @param {string} name
 * @param {{ head(key: string): Promise<unknown> }} bucket
 * @returns {HealthCheck}
 */
export function r2Check(name: string, bucket: {
    head(key: string): Promise<unknown>;
}): HealthCheck;
/**
 * A check that a KV namespace answers: a `get` of a fixed key, where null passes and a throw fails.
 * @param {string} name
 * @param {{ get(key: string): Promise<unknown> }} kv
 * @returns {HealthCheck}
 */
export function kvCheck(name: string, kv: {
    get(key: string): Promise<unknown>;
}): HealthCheck;
/**
 * A check that no cache purge is outstanding: `recordPurge` (edge-cache) keeps the last failed purge in KV until one
 * succeeds, so pages that may be stale show here. Level warn. The detail names only the time, since the reason can
 * name a draft.
 * @param {{ get(key: string): Promise<string | null> }} kv
 * @returns {HealthCheck}
 */
export function purgeCheck(kv: {
    get(key: string): Promise<string | null>;
}): HealthCheck;
/**
 * Keeps whether an AI feature's last real call worked, for `aiOutcomeCheck`. A failure is kept (with the reason kind
 * and the time) until a call succeeds, except `aborted` (a reader leaving a stream), which changes nothing; a success deletes it, after a read, so a healthy feature costs no KV writes. It
 * runs no model and never throws, so a broken KV can never fail the answer a reader is waiting on. `result` is a
 * `./anthropic` `onResult` record (`ok`, `kind`), or `{ ok, kind }` from a caller of any other model.
 * @param {{ get(key: string): Promise<string | null>, put(key: string, value: string, options?: { expirationTtl?: number }): Promise<unknown>, delete(key: string): Promise<unknown> } | undefined} kv
 * @param {string} feature "ask", "companion", "alt-text"
 * @param {{ ok: boolean, kind?: string | null }} result
 * @param {(line: string) => void} [log]
 */
export function recordAiOutcome(kv: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options?: {
        expirationTtl?: number;
    }): Promise<unknown>;
    delete(key: string): Promise<unknown>;
} | undefined, feature: string, result: {
    ok: boolean;
    kind?: string | null;
}, log?: (line: string) => void): Promise<void>;
/**
 * A check that an AI feature's last real call worked: `recordAiOutcome` keeps the last failure in KV until a call
 * succeeds (or a day passes), so a feature that fails every call (a spend cap, a revoked key, a removed model) shows
 * here while its bindings still look fine. It runs no model: every call is billed. Level warn. The detail names the
 * kind and time only, never the provider's message.
 * @param {string} feature the name given to `recordAiOutcome`; the check is named `ai-<feature>`
 * @param {{ get(key: string): Promise<string | null> }} kv
 * @returns {HealthCheck}
 */
export function aiOutcomeCheck(feature: string, kv: {
    get(key: string): Promise<string | null>;
}): HealthCheck;
/**
 * The spike alert for sign-in (F3): a check that fails when, in the last `windowMinutes`, failed sign-ins or sign-in
 * mails passed their ceiling, read from `./sign-in`'s `auth_events` table (`eventsDb`). Level warn, so the site stays
 * up and a deploy is never rolled back for it, and an alert (`alert: true` on its result, and in `alerts`), so the
 * watcher mails a person. The detail gives the counts, never an address.
 * @param {import("./sign-in-account.mjs").D1Like} db
 * @param {{ windowMinutes?: number, failures?: number, mails?: number, now?: () => number }} [limits]
 * @returns {HealthCheck}
 */
export function authSpikeCheck(db: import("./sign-in-account.mjs").D1Like, { windowMinutes, failures, mails, now }?: {
    windowMinutes?: number;
    failures?: number;
    mails?: number;
    now?: () => number;
}): HealthCheck;
/**
 * A check that the Images binding answers: `info` on a 1 x 1 GIF, which reads the image's header and transforms
 * nothing. Level warn, so a broken resize path shows without taking the site to 503.
 * @param {string} name
 * @param {{ info(stream: ReadableStream<Uint8Array>): Promise<unknown> }} images
 * @returns {HealthCheck}
 */
export function imagesCheck(name: string, images: {
    info(stream: ReadableStream<Uint8Array>): Promise<unknown>;
}): HealthCheck;
/**
 * A check that a Durable Object namespace is bound and can mint an id (`idFromName`, no request to an object, which
 * would wake one and bill it). Level warn.
 * @param {string} name
 * @param {{ idFromName(name: string): unknown } | undefined} namespace
 * @returns {HealthCheck}
 */
export function durableObjectCheck(name: string, namespace: {
    idFromName(name: string): unknown;
} | undefined): HealthCheck;
/**
 * A check that a Queue producer binding is present. It sends nothing: a probe message would reach the consumer. Level warn.
 * @param {string} name
 * @param {{ send(message: unknown): Promise<unknown> } | undefined} queue
 * @returns {HealthCheck}
 */
export function queueCheck(name: string, queue: {
    send(message: unknown): Promise<unknown>;
} | undefined): HealthCheck;
/**
 * A check that the Workers AI binding is present. It runs no model: every call is billed. Level warn.
 * @param {string} name
 * @param {{ run(...args: never[]): Promise<unknown> } | undefined} ai
 * @returns {HealthCheck}
 */
export function aiCheck(name: string, ai: {
    run(...args: never[]): Promise<unknown>;
} | undefined): HealthCheck;
/**
 * A check that a Send Email binding (`send_email` in the wrangler config) is present. It sends nothing: a probe would mail
 * someone. Level warn.
 * @param {string} name
 * @param {{ send(message: unknown): Promise<unknown> } | undefined} email
 * @returns {HealthCheck}
 */
export function emailCheck(name: string, email: {
    send(message: unknown): Promise<unknown>;
} | undefined): HealthCheck;
/**
 * A check that a Browser Rendering binding is present. It opens no browser: a session is billed. Level warn.
 * @param {string} name
 * @param {{ fetch(...args: never[]): Promise<unknown> } | undefined} browser
 * @returns {HealthCheck}
 */
export function browserCheck(name: string, browser: {
    fetch(...args: never[]): Promise<unknown>;
} | undefined): HealthCheck;
/**
 * Turns a database-down error into the 503 a React Router loader throws, so the error page says the site's data is
 * briefly unavailable instead of "Something went wrong", and the reader is told to try again (Retry-After 60). A thrown
 * Response reaches the client's error boundary intact, where a thrown Error is replaced by a generic one in production.
 * Any other error is returned unchanged: `catch (error) { throw databaseDown(error); }`.
 * @param {unknown} error
 * @returns {unknown}
 */
export function databaseDown(error: unknown): unknown;
/** The longest `detail` a check reports. */
export const CHECK_DETAIL_MAX: 200;
export { isDatabaseDown };
/** The statusText Capsomer's ErrorPage reads to say the database is down. */
export const DATABASE_DOWN_STATUS_TEXT: "Database unavailable";
export type HealthCheck = {
    name: string;
    level?: "fail" | "warn";
    alert?: boolean;
    run: () => Promise<unknown>;
};
export type CronJobs = Array<{
    name: string;
    everyMinutes: number | null;
}>;
export type CheckResult = {
    name: string;
    status: "pass" | "warn" | "fail";
    detail?: string;
    alert?: true;
};
import { isDatabaseDown } from "./log.mjs";
