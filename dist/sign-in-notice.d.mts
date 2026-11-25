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
/** What `sendSecurityNotice` is called for. */
export const SECURITY_NOTICE_KINDS: readonly ["passkey-added", "passkey-removed", "sign-in-linked", "sign-in-unlinked", "email-changed", "sessions-revoked", "account-deleted", "new-device", "recovery"];
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
import type { NoticeDetail } from "./sign-in-account.mjs";
