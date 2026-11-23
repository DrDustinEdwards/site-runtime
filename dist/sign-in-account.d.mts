/**
 * The browser and system a user agent names ("Safari on iPhone", "Chrome on Windows"), one of them
 * alone when only one is known, or null. An iPad that asks for the desktop site says Macintosh, so it reads as a Mac.
 * @param {string | null | undefined} userAgent
 * @returns {string | null}
 */
export function deviceName(userAgent: string | null | undefined): string | null;
/**
 * The city, region and country Cloudflare placed a request in (`request.cf`), as words ("Portland, Oregon, United States"),
 * or null outside Workers and for a request built by the site.
 * @param {Request & { cf?: { city?: unknown, region?: unknown, country?: unknown } } | null | undefined} request
 * @returns {string | null}
 */
export function coarseLocation(request: (Request & {
    cf?: {
        city?: unknown;
        region?: unknown;
        country?: unknown;
    };
}) | null | undefined): string | null;
/** @typedef {{ headers: Headers, request?: Request, asResponse: false }} SessionLookup */
/**
 * The argument for a site's own `auth.api.getSession` with `sessionDetails`: on a GET the request too, so the place
 * follows the person. Always `asResponse: false`: given a request, Better Auth 1.7.12 answers with a Response, which
 * has no `user`: every page reads the person as signed out (Foxing #169).
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
 * The passkey's provider in words, from its AAGUID, else null (registration stores it as the name, so an unknown one
 * stays blank). With no attestation (as `./sign-in` asks) Apple reports the all-zero AAGUID, so with an iPhone, iPad
 * or Mac user agent a zero reads as Apple Passwords.
 * @param {string | null | undefined} aaguid
 * @param {string | null} [userAgent] the browser that made it, at registration
 * @returns {string | null}
 */
export function knownProvider(aaguid: string | null | undefined, userAgent?: string | null): string | null;
/**
 * The passkey's provider in words, for a page: `knownProvider`, else "Passkey".
 * @param {string | null | undefined} aaguid
 * @param {string | null} [userAgent]
 */
export function passkeyProvider(aaguid: string | null | undefined, userAgent?: string | null): string;
/**
 * What a passkey list shows for one: the name it was given (at registration `./sign-in` stores the provider's), else
 * the provider's, else "Passkey".
 * @param {{ name?: string | null, aaguid?: string | null }} passkey
 */
export function passkeyLabel(passkey: {
    name?: string | null;
    aaguid?: string | null;
}): string;
/**
 * @typedef {{ id: string, name?: string | null, aaguid?: string | null, credentialID?: string | null, createdAt?: Date | string | null }} PasskeyRow
 *   A row of Better Auth's `listPasskeys`.
 * @typedef {{ id: string, credentialId: string | null, name: string, provider: string, createdAt: Date | null, lastUsedAt: Date | null }} AccountPasskey
 */
/**
 * The passkeys as a page lists them, oldest first: `id` (for rename and delete), `credentialId` (the public credential
 * id, base64url, for the Signal API in `./sign-in-client`), `name` (passkeyLabel), `provider`, `createdAt` and
 * `lastUsedAt` (from `passkeyLastUsed`, null when unknown). No public key.
 * @param {PasskeyRow[]} passkeys
 * @param {Map<string, Date>} [lastUsed]
 * @returns {AccountPasskey[]}
 */
export function passkeyRows(passkeys: PasskeyRow[], lastUsed?: Map<string, Date>): AccountPasskey[];
/**
 * When each of a person's passkeys last signed them in, by passkey id: the newest passkey sign-in row in
 * `auth_events` (`change` is the passkey's id; rows go after a year, `pruneAuthEvents`). Better Auth keeps no last-used time.
 * @param {D1Like} db @param {string} userId
 * @returns {Promise<Map<string, Date>>}
 */
export function passkeyLastUsed(db: D1Like, userId: string): Promise<Map<string, Date>>;
/**
 * The asker's passkeys for the account page (`passkeyRows`), with when each was last used when `db` is the site's
 * `eventsDb`; null when nobody is signed in. Listing and renaming need no fresh sign-in; deleting does (FRESH_SECONDS).
 * @param {{ api: {
 *   getSession(o: SessionLookup): Promise<{ user: { id: string } } | null>,
 *   listPasskeys(o: { headers: Headers }): Promise<PasskeyRow[]>,
 * } }} auth
 * @param {Request} request
 * @param {D1Like | null} [db]
 */
export function accountPasskeys(auth: {
    api: {
        getSession(o: SessionLookup): Promise<{
            user: {
                id: string;
            };
        } | null>;
        listPasskeys(o: {
            headers: Headers;
        }): Promise<PasskeyRow[]>;
    };
}, request: Request, db?: D1Like | null): Promise<AccountPasskey[] | null>;
/** Whether the account page suggests adding another passkey (A9): exactly one, so losing that device locks them out. */
export function needsSecondPasskey(passkeys: unknown[]): boolean;
/**
 * Records a "Not now" on the passkey offer, as an `auth_events` row for the person (so it holds on every device), and
 * never throws.
 * @param {D1Like} db @param {string} userId @param {{ request?: Request | null, at?: number }} [options]
 */
export function dismissPasskeyOffer(db: D1Like, userId: string, { request, at }?: {
    request?: Request | null;
    at?: number;
}): Promise<void>;
/**
 * Whether to offer a passkey after a sign-in by link, code, Google or Apple (A3): the person has none and has not
 * said "Not now" in the last PASSKEY_OFFER_DAYS. The page also checks `canOfferPasskey` (`./sign-in-client`).
 * @param {D1Like} db the site's `eventsDb`
 * @param {string} userId
 * @param {unknown[] | number} passkeys the person's passkeys (`listPasskeys`), or how many
 * @param {number} [now]
 */
export function shouldOfferPasskey(db: D1Like, userId: string, passkeys: unknown[] | number, now?: number): Promise<boolean>;
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
 * @typedef {{ event: string, fields: Record<string, unknown>, level?: "warn", email?: unknown, notice?: { kind: SecurityNoticeKind, scope?: string, passkeyName?: string } }} AuthEvent
 */
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
 * Deletes rows with no user after 30 days and every row after a year: a site runs it as a daily job (`./cron`).
 * Deleting an account deletes that person's rows at once (`./sign-in`).
 * @param {D1Like} db @param {number} [now]
 */
export function pruneAuthEvents(db: D1Like, now?: number): Promise<void>;
/**
 * Deletes Better Auth's expired sessions and expired one-time values (links, codes, email-change tokens), which it
 * never deletes itself. The same cleanup as EmDash 1.4.0 (emdash-cms/emdash#4287, MIT). The tables are `session` and
 * `verification`, with `expires_at` in ms.
 * @param {D1Like} db @param {number} [now]
 */
export function pruneExpiredAuth(db: D1Like, now?: number): Promise<void>;
/**
 * The nightly job that runs pruneAuthEvents and pruneExpiredAuth, named "prune-auth-events" on every site (one minute).
 * @param {D1Like} db
 * @returns {import("./cron.mjs").CronJob}
 */
export function pruneAuthEventsJob(db: D1Like): import("./cron.mjs").CronJob;
/**
 * The words of a notice, for the site's mail (Capsomer's `securityNotice` takes them as they are).
 * @param {string} kind one of SECURITY_NOTICE_KINDS
 * @param {{ siteName: string, at?: Date, userAgent?: string | null, request?: Request | null, scope?: string,
 *   passkeyName?: string, provider?: string, oldEmail?: string, newEmail?: string, toOldAddress?: boolean }} facts
 * @returns {NoticeDetail}
 */
export function noticeDetail(kind: string, { siteName, at, userAgent, request, toOldAddress, ...facts }: {
    siteName: string;
    at?: Date;
    userAgent?: string | null;
    request?: Request | null;
    scope?: string;
    passkeyName?: string;
    provider?: string;
    oldEmail?: string;
    newEmail?: string;
    toOldAddress?: boolean;
}): NoticeDetail;
/**
 * @typedef {{ id: string, email: string, name?: string | null }} NoticeUser
 * @typedef {(kind: SecurityNoticeKind, notice: { user: NoticeUser, request?: Request, detail: NoticeDetail }) => Promise<void> | void} SendSecurityNotice
 */
/**
 * Calls the site's sender and never throws: a failure is logged (`security_notice_failed`, the kind and the error with
 * any address cut out) and the change stands. A recipient on Email Service's suppression list (`./email`
 * isRecipientSuppressed) is a warning, `security_notice_undeliverable`, not a fault.
 * @param {SendSecurityNotice} send
 * @param {SecurityNoticeKind} kind
 * @param {{ user: NoticeUser, request?: Request, detail: NoticeDetail }} notice
 */
export function sendNoticeSafely(send: SendSecurityNotice, kind: SecurityNoticeKind, notice: {
    user: NoticeUser;
    request?: Request;
    detail: NoticeDetail;
}): Promise<void>;
/**
 * @typedef {(typeof SECURITY_NOTICE_KINDS)[number]} SecurityNoticeKind
 */
/**
 * @typedef {object} SecurityHistoryEntry
 * @property {| "sign-in" | "passkey-added" | "passkey-removed" | "sign-in-linked" | "sign-in-unlinked" | "email-changed" | "recovery"} kind
 * @property {string | null} via The way in for a sign-in ("link", "code", "passkey", "google", "apple"), the provider for a link or unlink.
 * @property {Date} at
 * @property {string | null} device
 * @property {string | null} location
 */
/**
 * @typedef {object} AccountSession
 * @property {string} id
 * @property {string | null} device
 * @property {Date} signedInAt
 * @property {Date} lastActiveAt
 * @property {boolean} current
 * @property {string | null} location
 */
/** What `sendSecurityNotice` is called for. */
export const SECURITY_NOTICE_KINDS: readonly ["passkey-added", "passkey-removed", "sign-in-linked", "sign-in-unlinked", "email-changed", "sessions-revoked", "account-deleted", "new-device", "recovery"];
/**
 * How recent a sign-in must be for a risky change: 10 minutes. `./sign-in` sets Better Auth's session.freshAge to it,
 * and its own check holds passkey delete and email change to it too (Better Auth 1.7.25 does not).
 */
export const FRESH_SECONDS: number;
/** How often a session's last activity is written: at most once in five minutes (txasm's touch). */
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
/** How long a "Not now" on the passkey offer holds: 30 days. */
export const PASSKEY_OFFER_DAYS: 30;
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
export type SessionLookup = {
    headers: Headers;
    request?: Request;
    asResponse: false;
};
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
/**
 * A row of Better Auth's `listPasskeys`.
 */
export type PasskeyRow = {
    id: string;
    name?: string | null;
    aaguid?: string | null;
    credentialID?: string | null;
    createdAt?: Date | string | null;
};
export type AccountPasskey = {
    id: string;
    credentialId: string | null;
    name: string;
    provider: string;
    createdAt: Date | null;
    lastUsedAt: Date | null;
};
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
export type AuthEvent = {
    event: string;
    fields: Record<string, unknown>;
    level?: "warn";
    email?: unknown;
    notice?: {
        kind: SecurityNoticeKind;
        scope?: string;
        passkeyName?: string;
    };
};
export type NoticeUser = {
    id: string;
    email: string;
    name?: string | null;
};
export type SendSecurityNotice = (kind: SecurityNoticeKind, notice: {
    user: NoticeUser;
    request?: Request;
    detail: NoticeDetail;
}) => Promise<void> | void;
export type SecurityNoticeKind = (typeof SECURITY_NOTICE_KINDS)[number];
export type SecurityHistoryEntry = {
    kind: "sign-in" | "passkey-added" | "passkey-removed" | "sign-in-linked" | "sign-in-unlinked" | "email-changed" | "recovery";
    /**
     * The way in for a sign-in ("link", "code", "passkey", "google", "apple"), the provider for a link or unlink.
     */
    via: string | null;
    at: Date;
    device: string | null;
    location: string | null;
};
export type AccountSession = {
    id: string;
    device: string | null;
    signedInAt: Date;
    lastActiveAt: Date;
    current: boolean;
    location: string | null;
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
/**
 * `title` for the subject and heading, `what` a sentence only when the title leaves something out (else null), `at` and `when` (in words, UTC), the device and place of the request
 * that made the change (null when unknown), and `secure`: what to do if it was not the person.
 */
export type NoticeDetail = {
    title: string;
    what: string | null;
    at: Date;
    when: string;
    device: string | null;
    location: string | null;
    secure: string;
    scope?: string;
    passkeyName?: string;
    provider?: string;
    oldEmail?: string;
    newEmail?: string;
};
