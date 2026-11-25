/** @import { SessionLookup } from "./sign-in-account.mjs" */
/**
 * The argument for a site's own `auth.api.getSession` with `sessionDetails`: on a GET the request too, so the place
 * follows the person. Always `asResponse: false`: given a request, Better Auth 1.7.25 answers with a Response, which
 * has no `user`: every page reads the person as signed out.
 * @param {Request} request
 * @returns {SessionLookup}
 */
export function sessionLookup(request: Request): SessionLookup;
/**
 * What to write to a session on use, or null: `updatedAt` now once SESSION_TOUCH_SECONDS have passed (with `location`
 * when known), or at once when the row has no place yet and this request has one. Freshness counts from `createdAt`,
 * so a touch never makes a sign-in look recent.
 * @param {{ updatedAt?: Date | string | null, createdAt?: Date | string | null, location?: unknown }} session
 * @param {string | null} place `coarseLocation` of the request, null when unknown
 * @param {number} [now]
 * @returns {{ updatedAt: Date, location?: string } | null}
 */
export function sessionTouch(session: {
    updatedAt?: Date | string | null;
    createdAt?: Date | string | null;
    location?: unknown;
}, place: string | null, now?: number): {
    updatedAt: Date;
    location?: string;
} | null;
/**
 * @typedef {{ id: string, token: string, userAgent?: string | null, createdAt: Date | string, updatedAt?: Date | string | null, location?: unknown }} SessionRow
 */
/**
 * Better Auth's `listSessions` rows as a page shows them, the current session first, then the most recently active:
 * `device`, `signedInAt`, `lastActiveAt` (`updatedAt`, moved on use only with `sessionDetails`), `current`, and
 * `location` when stored. No token: another device's would let a script on the page take over that session.
 * `revokeSessionById` ends one by its `id`.
 * @param {SessionRow[]} sessions
 * @param {string | null | undefined} currentToken the token of the session that asks (`getSession`'s `session.token`)
 */
export function sessionRows(sessions: SessionRow[], currentToken: string | null | undefined): {
    id: string;
    device: string | null;
    signedInAt: Date;
    lastActiveAt: Date;
    current: boolean;
    location: string | null;
}[];
/**
 * @typedef {{ api: {
 *   getSession(o: SessionLookup): Promise<{ session: { token: string } } | null>,
 *   listSessions(o: { headers: Headers }): Promise<SessionRow[]>,
 *   revokeSession(o: { headers: Headers, body: { token: string } }): Promise<unknown>,
 * } }} SessionsAuth
 */
/**
 * The sessions list for the person who asks (`sessionRows`), or null when Better Auth wants a fresh sign-in first
 * (`/list-sessions` refuses with SESSION_NOT_FRESH), so a page offers "sign in again" rather than failing.
 * @param {SessionsAuth} auth
 * @param {Request} request
 */
export function accountSessions(auth: SessionsAuth, request: Request): Promise<{
    id: string;
    device: string | null;
    signedInAt: Date;
    lastActiveAt: Date;
    current: boolean;
    location: string | null;
}[] | null>;
/**
 * Ends one of the asker's own sessions by its `id`, through Better Auth's /revoke-session, so no token leaves the
 * server. False when the id is not one of theirs. Throws SESSION_NOT_FRESH as `listSessions` does.
 * @param {SessionsAuth} auth
 * @param {Request} request
 * @param {string} id
 */
export function revokeSessionById(auth: SessionsAuth, request: Request, id: string): Promise<boolean>;
/**
 * Whether a session was made within `freshSeconds`. @param {{ createdAt: Date | string | number }} session
 * @param {number} [freshSeconds] @param {number} [now]
 */
export function sessionIsFresh(session: {
    createdAt: Date | string | number;
}, freshSeconds?: number, now?: number): boolean;
/**
 * The asker's session when it was made in the last FRESH_SECONDS, null when nobody is signed in, and a throw of
 * SessionNotFresh (logged as `authz_fail`) when the sign-in is older: for a site's own risky routes, such as exporting
 * or deleting an account, which Better Auth's freshAge does not reach.
 * @template {{ session: { createdAt: Date | string }, user: { id: string } }} S
 * @param {{ api: { getSession(o: SessionLookup): Promise<S | null> } }} auth
 * @param {Request} request
 * @returns {Promise<S | null>}
 */
export function requireFreshSession<S extends {
    session: {
        createdAt: Date | string;
    };
    user: {
        id: string;
    };
}>(auth: {
    api: {
        getSession(o: SessionLookup): Promise<S | null>;
    };
}, request: Request): Promise<S | null>;
/**
 * @typedef {object} AccountSession
 * @property {string} id
 * @property {string | null} device
 * @property {Date} signedInAt
 * @property {Date} lastActiveAt
 * @property {boolean} current
 * @property {string | null} location
 */
/**
 * How recent a sign-in must be for a risky change: 10 minutes. `./sign-in` sets Better Auth's session.freshAge to it,
 * and its own check holds passkey delete and email change to it too (Better Auth 1.7.25 does not).
 */
export const FRESH_SECONDS: number;
/** How often a session's last activity is written: at most once in five minutes. */
export const SESSION_TOUCH_SECONDS: number;
/**
 * The device cookie (`sessionDetails`): a random signed id set at each sign-in and kept 400 days (the longest a browser
 * keeps a cookie, RFC 6265bis), stored on the session row as `deviceId`; `__Secure-better-auth.device` on https.
 * Clear-Site-Data at sign-out clears it.
 */
export const DEVICE_COOKIE: "device";
export const DEVICE_COOKIE_SECONDS: number;
/**
 * The session columns `sessionDetails` needs, as a migration a site adds (drop a line for a column it has; txasm and
 * Foxhound have `location`). Drizzle: `location: text("location")`, `deviceId: text("device_id")`. With `eventsDb`,
 * AUTH_EVENTS_DEVICE_SQL as well.
 */
export const SESSION_DETAILS_SQL: "ALTER TABLE session ADD COLUMN location TEXT;\nALTER TABLE session ADD COLUMN device_id TEXT;\n";
/** The `auth_events` column for the device id of each sign-in, with `sessionDetails` and `eventsDb`. */
export const AUTH_EVENTS_DEVICE_SQL: "ALTER TABLE auth_events ADD COLUMN device_id TEXT;\n";
/**
 * The refusal for want of a recent sign-in, in Better Auth's shape (403, `body.code` "SESSION_NOT_FRESH"), so the
 * "sign in again" a page shows for Better Auth's own refusal works for a site's route too.
 */
export class SessionNotFresh extends Error {
    constructor();
    status: "FORBIDDEN";
    statusCode: 403;
    /** @type {{ code: "SESSION_NOT_FRESH", message: string }} */
    body: {
        code: "SESSION_NOT_FRESH";
        message: string;
    };
}
export type SessionRow = {
    id: string;
    token: string;
    userAgent?: string | null;
    createdAt: Date | string;
    updatedAt?: Date | string | null;
    location?: unknown;
};
export type SessionsAuth = {
    api: {
        getSession(o: SessionLookup): Promise<{
            session: {
                token: string;
            };
        } | null>;
        listSessions(o: {
            headers: Headers;
        }): Promise<SessionRow[]>;
        revokeSession(o: {
            headers: Headers;
            body: {
                token: string;
            };
        }): Promise<unknown>;
    };
};
export type AccountSession = {
    id: string;
    device: string | null;
    signedInAt: Date;
    lastActiveAt: Date;
    current: boolean;
    location: string | null;
};
import type { SessionLookup } from "./sign-in-account.mjs";
