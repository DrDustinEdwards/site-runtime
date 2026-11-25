export type D1Like = import("./sign-in-audit.mjs").D1Like;
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
export type SecurityNoticeKind = import("./sign-in-notice.mjs").SecurityNoticeKind;
export type SendSecurityNotice = import("./sign-in-notice.mjs").SendSecurityNotice;
export type AccountPasskey = {
    id: string;
    credentialId: string | null;
    name: string;
    provider: string;
    createdAt: Date | null;
    lastUsedAt: Date | null;
};
export type AccountSession = import("./sign-in-sessions.mjs").AccountSession;
export type SessionLookup = {
    headers: Headers;
    request?: Request;
    asResponse: false;
};
export type SessionRow = import("./sign-in-sessions.mjs").SessionRow;
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
export { coarseLocation, deviceName } from "./sign-in-device.mjs";
export { SECURITY_NOTICE_KINDS, noticeDetail, sendNoticeSafely } from "./sign-in-notice.mjs";
export { AUTH_EVENTS_SQL, authEvent, authEventCounts, hadPasskey, isNewDevice, isNewSignInDevice, logAuthEvent, outcome, securityHistory, signedInDeviceIds, signedInDevices } from "./sign-in-audit.mjs";
export { AUTH_EVENTS_DEVICE_SQL, DEVICE_COOKIE, DEVICE_COOKIE_SECONDS, FRESH_SECONDS, SESSION_DETAILS_SQL, SESSION_TOUCH_SECONDS, SessionNotFresh, accountSessions, requireFreshSession, revokeSessionById, sessionIsFresh, sessionLookup, sessionRows, sessionTouch } from "./sign-in-sessions.mjs";
export { PASSKEY_OFFER_DAYS, accountPasskeys, dismissPasskeyOffer, knownProvider, needsSecondPasskey, passkeyLabel, passkeyLastUsed, passkeyProvider, passkeyRows, shouldOfferPasskey } from "./sign-in-passkey-rows.mjs";
