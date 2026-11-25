/**
 * Account security for `./sign-in`, apart from it so it needs no Better Auth import; `./sign-in` re-exports it and runs
 * it from Better Auth's hooks. The pieces: the device a request names (`./sign-in-device`), notices
 * (`./sign-in-notice`), the auth event log and history (`./sign-in-audit`), sessions and the fresh sign-in
 * (`./sign-in-sessions`) and passkeys (`./sign-in-passkey-rows`).
 */
export { coarseLocation, deviceName } from "./sign-in-device.mjs";
export { SECURITY_NOTICE_KINDS, noticeDetail, sendNoticeSafely } from "./sign-in-notice.mjs";
export {
  AUTH_EVENTS_SQL,
  authEvent,
  authEventCounts,
  hadPasskey,
  isNewDevice,
  isNewSignInDevice,
  logAuthEvent,
  outcome,
  securityHistory,
  signedInDeviceIds,
  signedInDevices,
} from "./sign-in-audit.mjs";
export {
  AUTH_EVENTS_DEVICE_SQL,
  DEVICE_COOKIE,
  DEVICE_COOKIE_SECONDS,
  FRESH_SECONDS,
  SESSION_DETAILS_SQL,
  SESSION_TOUCH_SECONDS,
  SessionNotFresh,
  accountSessions,
  requireFreshSession,
  revokeSessionById,
  sessionIsFresh,
  sessionLookup,
  sessionRows,
  sessionTouch,
} from "./sign-in-sessions.mjs";
export {
  PASSKEY_OFFER_DAYS,
  accountPasskeys,
  dismissPasskeyOffer,
  knownProvider,
  needsSecondPasskey,
  passkeyLabel,
  passkeyLastUsed,
  passkeyProvider,
  passkeyRows,
  shouldOfferPasskey,
} from "./sign-in-passkey-rows.mjs";

/** @typedef {import("./sign-in-audit.mjs").D1Like} D1Like */
/**
 * @typedef {object} SecurityHistoryEntry
 */
/**
 * @typedef {{
 *   title: string, what: string | null, at: Date, when: string, device: string | null, location: string | null, secure: string,
 *   scope?: string, passkeyName?: string, provider?: string, oldEmail?: string, newEmail?: string,
 * }} NoticeDetail
 *   `title` for the subject and heading, `what` a sentence only when the title leaves something out (else null), `at` and `when` (in words, UTC), the device and place of the request
 *   that made the change (null when unknown), and `secure`: what to do if it was not the person.
 */
/** @typedef {import("./sign-in-notice.mjs").SecurityNoticeKind} SecurityNoticeKind */
/** @typedef {import("./sign-in-notice.mjs").SendSecurityNotice} SendSecurityNotice */
/**
 * @typedef {{ id: string, credentialId: string | null, name: string, provider: string, createdAt: Date | null, lastUsedAt: Date | null }} AccountPasskey
 
 */
/** @typedef {import("./sign-in-sessions.mjs").AccountSession} AccountSession */
/**
 @typedef {{ headers: Headers, request?: Request, asResponse: false }} SessionLookup 
 */
/** @typedef {import("./sign-in-sessions.mjs").SessionRow} SessionRow */

/**
 * @typedef {{ event: string, fields: Record<string, unknown>, level?: "warn", email?: unknown, notice?: { kind: SecurityNoticeKind, scope?: string, passkeyName?: string } }} AuthEvent
 
 */
