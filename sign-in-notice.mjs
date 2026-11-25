import { isRecipientSuppressed } from "./email.mjs";
import { logEvent } from "./log.mjs";
import { coarseLocation, deviceName } from "./sign-in-device.mjs";

/**
 * @typedef {(typeof SECURITY_NOTICE_KINDS)[number]} SecurityNoticeKind
 */

/** What `sendSecurityNotice` is called for. */
export const SECURITY_NOTICE_KINDS = /* @__PURE__ */ Object.freeze(
  /** @type {const} */ ([
    "passkey-added",
    "passkey-removed",
    "sign-in-linked",
    "sign-in-unlinked",
    "email-changed",
    "sessions-revoked",
    "account-deleted",
    "new-device",
    "recovery",
  ]),
);

const PROVIDER_NAMES = /** @type {Record<string, string>} */ ({ google: "Google", apple: "Apple" });

/** @param {string | undefined} providerId */
const providerName = (providerId) =>
  (providerId && PROVIDER_NAMES[providerId]) || providerId || "A sign-in method";

/** @import { NoticeDetail } from "./sign-in-account.mjs" */

const IF_NOT_YOU =
  "If this was not you, sign in now, remove any passkey or sign-in method you do not recognize, and sign out of every other device.";
const CONTACT = (/** @type {string} */ site) => `If this was not you, contact ${site} right away.`;

/**
 * The words of a notice, for the site's mail (Capsomer's `securityNotice` takes them as they are).
 * @param {string} kind one of SECURITY_NOTICE_KINDS
 * @param {{ siteName: string, at?: Date, userAgent?: string | null, request?: Request | null, scope?: string,
 *   passkeyName?: string, provider?: string, oldEmail?: string, newEmail?: string, toOldAddress?: boolean }} facts
 * @returns {NoticeDetail}
 */
export function noticeDetail(
  kind,
  { siteName, at = new Date(), userAgent, request, toOldAddress, ...facts },
) {
  const provider = providerName(facts.provider);
  /** @type {Record<string, [string, string | null, string]>} */
  const words = {
    "passkey-added": [
      `A passkey${facts.passkeyName ? ` from ${facts.passkeyName}` : ""} was added to your account`,
      null,
      IF_NOT_YOU,
    ],
    "passkey-removed": ["A passkey was removed from your account", null, IF_NOT_YOU],
    "sign-in-linked": [`You can now sign in with ${provider}`, null, IF_NOT_YOU],
    "sign-in-unlinked": [`You can no longer sign in with ${provider}`, null, IF_NOT_YOU],
    "email-changed": [
      "Your account's email address changed",
      `It changed from ${facts.oldEmail} to ${facts.newEmail}.`,
      toOldAddress ? `${CONTACT(siteName)} Sign-in links now go to the new address.` : IF_NOT_YOU,
    ],
    "sessions-revoked": [
      facts.scope === "others"
        ? "You were signed out on your other devices"
        : "You were signed out everywhere",
      null,
      "If this was not you, sign in again and check your passkeys and sign-in methods.",
    ],
    "account-deleted": ["Your account and its data were deleted", null, CONTACT(siteName)],
    "new-device": [
      "A new device signed in to your account",
      null,
      "If this was not you, sign in now, end that device's session, and check your passkeys and sign-in methods.",
    ],
    recovery: [
      "You signed in by email, with no passkey on your account",
      "Every other device was signed out. Add a passkey now so you can sign in without email next time.",
      IF_NOT_YOU,
    ],
  };
  const [title, what, secure] = words[kind];
  return {
    title,
    what,
    at,
    when: `${at.toLocaleString("en-US", { timeZone: "UTC", dateStyle: "long", timeStyle: "short" })} UTC`,
    device: deviceName(userAgent ?? request?.headers.get("user-agent")),
    location: coarseLocation(request),
    secure,
    ...(facts.scope ? { scope: facts.scope } : {}),
    ...(facts.passkeyName ? { passkeyName: facts.passkeyName } : {}),
    ...(facts.provider ? { provider } : {}),
    ...(facts.oldEmail ? { oldEmail: facts.oldEmail, newEmail: facts.newEmail } : {}),
  };
}

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
export async function sendNoticeSafely(send, kind, notice) {
  try {
    await send(kind, notice);
  } catch (error) {
    if (isRecipientSuppressed(error))
      logEvent(
        "security_notice_undeliverable",
        { kind, user_id: notice.user.id },
        { level: "warn" },
      );
    else
      logEvent(
        "security_notice_failed",
        { kind, user_id: notice.user.id, error },
        { level: "error" },
      );
  }
}
