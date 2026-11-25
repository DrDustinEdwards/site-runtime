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
/** @typedef {import("./sign-in-audit.mjs").SecurityHistoryEntry} SecurityHistoryEntry */
/** @typedef {import("./sign-in-notice.mjs").NoticeDetail} NoticeDetail */
/** @typedef {import("./sign-in-notice.mjs").SecurityNoticeKind} SecurityNoticeKind */
/** @typedef {import("./sign-in-notice.mjs").SendSecurityNotice} SendSecurityNotice */
/** @typedef {import("./sign-in-passkey-rows.mjs").AccountPasskey} AccountPasskey */
/** @typedef {import("./sign-in-sessions.mjs").AccountSession} AccountSession */
/** @typedef {import("./sign-in-sessions.mjs").SessionLookup} SessionLookup */
/** @typedef {import("./sign-in-sessions.mjs").SessionRow} SessionRow */
