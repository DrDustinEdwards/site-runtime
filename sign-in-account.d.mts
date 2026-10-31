/**
 * Account security for ./sign-in (sign-in-account.mjs): the auth event log and its table, the security history, fresh
 * sign-in for a site's own routes, security notices, sessions list, and the passkey list, offer and nudge.
 */

/** What `sendSecurityNotice` is called for. */
export const SECURITY_NOTICE_KINDS: readonly [
  "passkey-added",
  "passkey-removed",
  "sign-in-linked",
  "sign-in-unlinked",
  "email-changed",
  "sessions-revoked",
  "account-deleted",
  "new-device",
  "recovery",
];
export type SecurityNoticeKind = (typeof SECURITY_NOTICE_KINDS)[number];

/** How recent a sign-in must be for a risky change: 600 seconds (Better Auth's session.freshAge, and ./sign-in's own check). */
export const FRESH_SECONDS: 600;
/** Whether a session was made within `freshSeconds` (default FRESH_SECONDS). */
export function sessionIsFresh(session: { createdAt: Date | string | number }, freshSeconds?: number, now?: number): boolean;
/** The refusal for want of a recent sign-in, in Better Auth's shape: 403, `body.code` "SESSION_NOT_FRESH". */
export class SessionNotFresh extends Error {
  status: "FORBIDDEN";
  statusCode: 403;
  body: { code: "SESSION_NOT_FRESH"; message: string };
}
/**
 * The asker's session when it was made in the last FRESH_SECONDS, null when nobody is signed in; throws SessionNotFresh
 * (logged as `authz_fail`) when older. For a site's own risky routes: export and delete account.
 */
export function requireFreshSession<S extends { session: { createdAt: Date | string }; user: { id: string } }>(
  auth: { api: { getSession(o: { headers: Headers }): Promise<S | null> } },
  request: Request,
): Promise<S | null>;

/** The D1 calls the event table needs. */
export type D1Like = {
  prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown>; all(): Promise<{ results: any[] }> } };
};
/** The migration for `auth_events`: one row per auth event, no address, token or code. */
export const AUTH_EVENTS_SQL: string;
/** Writes one event's row; a failed write is logged (`auth_event_write_failed`) and never throws. */
export function recordAuthEvent(
  db: D1Like,
  row: { event: string; fields: Record<string, unknown>; userAgent?: string | null; request?: Request | null; at?: number },
): Promise<void>;
export type SecurityHistoryEntry = {
  kind: "sign-in" | "passkey-added" | "passkey-removed" | "sign-in-linked" | "sign-in-unlinked" | "email-changed" | "recovery";
  /** The way in for a sign-in ("link", "code", "passkey", "google", "apple"), the provider for a link or unlink. */
  via: string | null;
  at: Date;
  device: string | null;
  location: string | null;
};
/** A person's sign-ins, passkey, sign-in method and email changes and recoveries, newest first (default 50). */
export function securityHistory(db: D1Like, userId: string, limit?: number): Promise<SecurityHistoryEntry[]>;
/** The devices (deviceName) a person has signed in from, from their history. */
export function signedInDevices(db: D1Like, userId: string): Promise<(string | null)[]>;
/** Whether a person's history shows a passkey added. */
export function hadPasskey(db: D1Like, userId: string): Promise<boolean>;
/** Whether a sign-in's device is new: the person has signed in before, never from this device. */
export function isNewDevice(device: string | null, seen: (string | null)[]): boolean;
/** Failed sign-ins and sign-in mails since `sinceMs`. */
export function authEventCounts(db: D1Like, sinceMs: number): Promise<{ failures: number; mails: number }>;
/** Deletes rows with no user after 30 days and every row after a year: a daily job. */
export function pruneAuthEvents(db: D1Like, now?: number): Promise<void>;

/** "Safari on iPhone", "Chrome on Windows", one of the two alone, or null. */
export function deviceName(userAgent: string | null | undefined): string | null;
/** The city, region and country in `request.cf` as words, or null. */
export function coarseLocation(request: (Request & { cf?: { city?: unknown; region?: unknown; country?: unknown } }) | null | undefined): string | null;

export type SessionRow = {
  id: string;
  token: string;
  userAgent?: string | null;
  createdAt: Date | string;
  updatedAt?: Date | string | null;
  location?: unknown;
};
export type AccountSession = {
  id: string;
  device: string | null;
  signedInAt: Date;
  lastActiveAt: Date;
  current: boolean;
  location: string | null;
};
/** Better Auth's listSessions rows for a page: current first, then most recently active. No token: end one by id. */
export function sessionRows(sessions: SessionRow[], currentToken: string | null | undefined): AccountSession[];

export type SessionsAuth = {
  api: {
    getSession(o: { headers: Headers }): Promise<{ session: { token: string } } | null>;
    listSessions(o: { headers: Headers }): Promise<SessionRow[]>;
    revokeSession(o: { headers: Headers; body: { token: string } }): Promise<unknown>;
  };
};
/** The asker's sessions list, or null when Better Auth wants a fresh sign-in first (SESSION_NOT_FRESH). */
export function accountSessions(auth: SessionsAuth, request: Request): Promise<AccountSession[] | null>;
/** Ends one of the asker's own sessions by id, server-side; false when the id is not theirs. */
export function revokeSessionById(auth: SessionsAuth, request: Request, id: string): Promise<boolean>;

/** The passkey's provider from its AAGUID ("Apple Passwords", "Google Password Manager", "YubiKey 5 Series", ...), else null. */
export function knownProvider(aaguid: string | null | undefined, userAgent?: string | null): string | null;
/** knownProvider, else "Passkey". */
export function passkeyProvider(aaguid: string | null | undefined, userAgent?: string | null): string;
/** The passkey's name, else its provider's, else "Passkey". */
export function passkeyLabel(passkey: { name?: string | null; aaguid?: string | null }): string;

/** A row of Better Auth's `listPasskeys`. */
export type PasskeyRow = { id: string; name?: string | null; aaguid?: string | null; createdAt?: Date | string | null };
/** One passkey as the account page lists it. */
export type AccountPasskey = { id: string; name: string; provider: string; createdAt: Date | null; lastUsedAt: Date | null };
/** The passkeys as a page lists them, oldest first, with `lastUsed` from passkeyLastUsed. */
export function passkeyRows(passkeys: PasskeyRow[], lastUsed?: Map<string, Date>): AccountPasskey[];
/** When each of a person's passkeys last signed them in, by passkey id, from `auth_events` (the last year). */
export function passkeyLastUsed(db: D1Like, userId: string): Promise<Map<string, Date>>;
/** The asker's passkeys with when each was last used (with the site's eventsDb); null when nobody is signed in. */
export function accountPasskeys(
  auth: {
    api: {
      getSession(o: { headers: Headers }): Promise<{ user: { id: string } } | null>;
      listPasskeys(o: { headers: Headers }): Promise<PasskeyRow[]>;
    };
  },
  request: Request,
  db?: D1Like | null,
): Promise<AccountPasskey[] | null>;
/** True with exactly one passkey: the account page suggests adding another (A9). */
export function needsSecondPasskey(passkeys: unknown[]): boolean;

/** How long a "Not now" on the passkey offer holds: 30 days. */
export const PASSKEY_OFFER_DAYS: 30;
/** The `auth_events` event of a "Not now" on the passkey offer. */
export const PASSKEY_OFFER_DISMISSED: "passkey_offer_dismissed";
/** Records a "Not now" on the passkey offer for the person; never throws. */
export function dismissPasskeyOffer(db: D1Like, userId: string, options?: { request?: Request | null; at?: number }): Promise<void>;
/** Whether to offer a passkey after another sign-in: none yet, and no "Not now" in the last PASSKEY_OFFER_DAYS. */
export function shouldOfferPasskey(db: D1Like, userId: string, passkeys: unknown[] | number, now?: number): Promise<boolean>;

/** How a Better Auth endpoint ended, from its after hook's `ctx.context.returned`. */
export function outcome(returned: unknown): { ok: boolean; code?: string };

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
  notice?: { kind: SecurityNoticeKind; scope?: string; passkeyName?: string };
};
/** The log line, and the notice if any, for one Better Auth request, or null. */
export function authEvent(facts: EndpointFacts): AuthEvent | null;
/** Writes the event's line with the address hashed (`email_key`), never in clear; with `db`, its `auth_events` row too. */
export function logAuthEvent(
  event: Pick<AuthEvent, "event" | "fields" | "level" | "email">,
  where?: { db?: D1Like | null; userAgent?: string | null; request?: Request | null },
): Promise<void>;

/** "Google", "Apple", else the provider id. */
export function providerName(providerId: string | undefined): string;

export type NoticeDetail = {
  /** For the subject: "A passkey was added to your account". */
  title: string;
  /** A sentence only when the title leaves something out (the old and new address), else null. */
  what: string | null;
  at: Date;
  /** `at` in words, UTC: "October 31, 2026 at 1:52 AM UTC". */
  when: string;
  /** The browser and system that made the change, or null. */
  device: string | null;
  /** Where Cloudflare placed that request, or null. */
  location: string | null;
  /** What to do if it was not the person. */
  secure: string;
  scope?: string;
  passkeyName?: string;
  provider?: string;
  oldEmail?: string;
  newEmail?: string;
};
/** The words of a notice. */
export function noticeDetail(
  kind: SecurityNoticeKind | string,
  facts: {
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
  },
): NoticeDetail;

export type NoticeUser = { id: string; email: string; name?: string | null };
/** The site's sender: mails `detail` to `user.email`. */
export type SendSecurityNotice = (
  kind: SecurityNoticeKind,
  notice: { user: NoticeUser; request?: Request; detail: NoticeDetail },
) => Promise<void> | void;
/** Calls the sender and never throws; a failure is logged as `security_notice_failed`. */
export function sendNoticeSafely(
  send: SendSecurityNotice,
  kind: SecurityNoticeKind,
  notice: { user: NoticeUser; request?: Request; detail: NoticeDetail },
): Promise<void>;
