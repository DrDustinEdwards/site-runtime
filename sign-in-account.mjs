/**
 * Account security for `./sign-in`, apart from it so it needs no Better Auth import; `./sign-in` re-exports it and
 * runs it from Better Auth's hooks.
 *
 * - THE AUTH EVENT LOG (F2): one `./log` line per sign-in event, named from the OWASP Logging Vocabulary
 *   (OWASP_EVENTS). A line holds the user's id and, where there is no user yet, the address as `emailKey` hashes it;
 *   never the address, a token, a code or a session id.
 * - SECURITY NOTICES (A8, E1, NIST SP 800-63B-4 4.1.2.1 and 4.6): the site's `sendSecurityNotice(kind, { user,
 *   request, detail })` hears of each change to how a person signs in, with when, the device in plain words and the
 *   coarse place Cloudflare saw (`request.cf`). A failed send is logged and never undoes or blocks the change.
 * - SECURITY HISTORY (E5): with the site's D1 (`eventsDb`), each event is also a row in `auth_events`
 *   (AUTH_EVENTS_SQL); `securityHistory` reads them back and `authEventCounts` feeds /health's spike check.
 * - FRESH SIGN-IN (A7, D6): `requireFreshSession` for a site's own risky routes, the same 10-minute rule `./sign-in`
 *   holds Better Auth's endpoints to.
 * - THE SESSIONS LIST (D5): `sessionRows` turns `listSessions` rows into what a page shows; with `sessionDetails`
 *   (`./sign-in`) each session keeps its coarse place, last use (`sessionTouch`) and a device id from a cookie (E4).
 * - PASSKEYS (A3, A5, A9): `passkeyProvider` names a provider from its AAGUID; `accountPasskeys` lists each passkey;
 *   `shouldOfferPasskey` and `dismissPasskeyOffer` keep the offer after sign-in for people with none who have not
 *   said "Not now"; `needsSecondPasskey` is the nudge toward a second one.
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
