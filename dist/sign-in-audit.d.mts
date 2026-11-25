/** @typedef {import("./sign-in-notice.mjs").SecurityNoticeKind} SecurityNoticeKind */
/**
 * @property {| "sign-in" | "passkey-added" | "passkey-removed" | "sign-in-linked" | "sign-in-unlinked" | "email-changed" | "recovery"} kind
 * @property {string | null} via The way in for a sign-in ("link", "code", "passkey", "google", "apple"), the provider for a link or unlink.
 * @property {Date} at
 * @property {string | null} device
 * @property {string | null} location
 
 */
/** @import { SecurityHistoryEntry } from "./sign-in-account.mjs" */
/**
 * Whether a sign-in's device is new to the person, by device id when their sessions or history carry any, else by
 * `deviceName` of the user agent. A first sign-in is no new device.
 * @param {{ id: string | null, name: string | null }} device
 * @param {{ ids: (string | null)[], names: (string | null)[] }} seen
 */
export function isNewSignInDevice(device: {
    id: string | null;
    name: string | null;
}, seen: {
    ids: (string | null)[];
    names: (string | null)[];
}): boolean;
/**
 * How an endpoint ended, from what Better Auth's after hook holds (`ctx.context.returned`): an APIError for a refusal,
 * and for a redirect, which Better Auth also throws, a failure only when the location carries `error`.
 * @param {unknown} returned
 * @returns {{ ok: boolean, code?: string }}
 */
export function outcome(returned: unknown): {
    ok: boolean;
    code?: string;
};
/**
 * @typedef {{
 *   path: string, params?: Record<string, string | undefined>, body?: Record<string, unknown>, returned: unknown,
 *   signedIn: boolean, userId?: string | null, linking?: boolean,
 * }} EndpointFacts
 *   What one Better Auth request was: its endpoint path, route params and body, what it returned, whether it made a
 *   session (`ctx.context.newSession`), whose session it ran in, and for an OAuth callback whether it linked an account
 *   rather than signing in.
 */
/** @import { AuthEvent } from "./sign-in-account.mjs" */
/**
 * The log line, and the notice if any, for one Better Auth request, or null for a request that is not an auth event.
 * Linking an account, the email change and the account's deletion are told by `./sign-in`'s database hooks instead,
 * which see the account's provider and both addresses.
 * @param {EndpointFacts} facts
 * @returns {AuthEvent | null}
 */
export function authEvent({ path, params, body, returned, signedIn, userId, linking }: EndpointFacts): AuthEvent | null;
/**
 * Writes an event's line, the address hashed as `emailKey` hashes it (`email_key`), never in clear; with `db`, also
 * its `auth_events` row (`recordAuthEvent`).
 * @param {Pick<AuthEvent, "event" | "fields" | "level" | "email">} event
 * @param {{ db?: D1Like | null, userAgent?: string | null, request?: Request | null, deviceId?: string | null }} [where]
 *   `deviceId` (string or null) only with `sessionDetails`, whose migration adds the column
 */
export function logAuthEvent({ event, fields, level, email }: Pick<AuthEvent, "event" | "fields" | "level" | "email">, { db, userAgent, request, deviceId }?: {
    db?: D1Like | null;
    userAgent?: string | null;
    request?: Request | null;
    deviceId?: string | null;
}): Promise<void>;
/**
 * Writes one event's row. A failed write is logged (`auth_event_write_failed`) and never stops the sign-in. `deviceId`
 * (string or null) writes the `device_id` column too (AUTH_EVENTS_DEVICE_SQL); left out, the row is written without it.
 * @param {D1Like} db
 * @param {{ event: string, fields: Record<string, unknown>, userAgent?: string | null, request?: Request | null, at?: number, deviceId?: string | null }} row
 */
export function recordAuthEvent(db: D1Like, { event, fields, userAgent, request, at, deviceId }: {
    event: string;
    fields: Record<string, unknown>;
    userAgent?: string | null;
    request?: Request | null;
    at?: number;
    deviceId?: string | null;
}): Promise<void>;
/**
 * A person's security history, newest first: each sign-in (`kind` "sign-in", with `via`), passkey added or removed,
 * sign-in method linked or unlinked, email change and recovery, with `at`, `device` and `location`.
 * @param {D1Like} db
 * @param {string} userId
 * @param {number} [limit]
 * @returns {Promise<SecurityHistoryEntry[]>}
 */
export function securityHistory(db: D1Like, userId: string, limit?: number): Promise<SecurityHistoryEntry[]>;
/**
 * The devices a person has signed in from (`deviceName`, null for an agent it cannot name), from their history.
 * @param {D1Like} db @param {string} userId
 * @returns {Promise<(string | null)[]>}
 */
export function signedInDevices(db: D1Like, userId: string): Promise<(string | null)[]>;
/**
 * The device ids a person has signed in from, from their history (`sessionDetails` with AUTH_EVENTS_DEVICE_SQL).
 * @param {D1Like} db @param {string} userId
 * @returns {Promise<string[]>}
 */
export function signedInDeviceIds(db: D1Like, userId: string): Promise<string[]>;
/** Whether a person's history shows a passkey added, so a sign-in with none left is a recovery. @param {D1Like} db @param {string} userId */
export function hadPasskey(db: D1Like, userId: string): Promise<boolean>;
/**
 * Whether the person has signed in before but never from this device. A first sign-in is no new device.
 * @param {string | null} device @param {(string | null)[]} seen
 */
export function isNewDevice(device: string | null, seen: (string | null)[]): boolean;
/**
 * Failed sign-ins and sign-in mails since `sinceMs`, for /health's spike check.
 * @param {D1Like} db @param {number} sinceMs
 * @returns {Promise<{ failures: number, mails: number }>}
 */
export function authEventCounts(db: D1Like, sinceMs: number): Promise<{
    failures: number;
    mails: number;
}>;
/**
 * @typedef {{ prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown>, all(): Promise<{ results: any[] }> } } }} D1Like
 */
/**
 * The migration a site that passes `eventsDb` adds as its next file under `migrations/`: one row per auth event, with
 * `at` in epoch ms, the OWASP `event`, the `change` or `scope` its line carries (a passkey's id for a passkey sign-in),
 * `via`, and the device and coarse place. No address, token or code. `user_id` is null before there is a user; those
 * rows are kept 30 days, a person's own a year (`pruneAuthEvents`).
 */
export const AUTH_EVENTS_SQL: "CREATE TABLE IF NOT EXISTS auth_events (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  at INTEGER NOT NULL,\n  event TEXT NOT NULL,\n  change TEXT,\n  via TEXT,\n  user_id TEXT,\n  device TEXT,\n  location TEXT\n);\nCREATE INDEX IF NOT EXISTS auth_events_user ON auth_events (user_id, at);\nCREATE INDEX IF NOT EXISTS auth_events_at ON auth_events (at, event);\n";
export type SecurityNoticeKind = import("./sign-in-notice.mjs").SecurityNoticeKind;
/**
 * What one Better Auth request was: its endpoint path, route params and body, what it returned, whether it made a
 * session (`ctx.context.newSession`), whose session it ran in, and for an OAuth callback whether it linked an account
 * rather than signing in.
 */
export type EndpointFacts = {
    path: string;
    params?: Record<string, string | undefined>;
    body?: Record<string, unknown>;
    returned: unknown;
    signedIn: boolean;
    userId?: string | null;
    linking?: boolean;
};
export type D1Like = {
    prepare(sql: string): {
        bind(...values: unknown[]): {
            run(): Promise<unknown>;
            all(): Promise<{
                results: any[];
            }>;
        };
    };
};
import type { AuthEvent } from "./sign-in-account.mjs";
import type { SecurityHistoryEntry } from "./sign-in-account.mjs";
