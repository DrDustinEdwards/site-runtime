/**
 * Whether a typed address is one a site may store and mail: the browser's own email-field rule, a dotted domain and at
 * most 254 characters. Trim it first; this does not.
 * @param {unknown} value
 * @returns {value is string}
 */
export function isEmail(value: unknown): value is string;
/**
 * Whether `error` is a send refused because the recipient is suppressed: an EmailNotSent, or anything carrying the
 * binding's code.
 * @param {unknown} error
 */
export function isRecipientSuppressed(error: unknown): boolean;
/**
 * Each of `secrets` cut out of `text`, as `[redacted]`. Empty entries are skipped.
 * @param {string} text
 * @param {readonly (string | null | undefined)[]} [secrets]
 */
export function redact(text: string, secrets?: readonly (string | null | undefined)[]): string;
/**
 * Send one mail through the binding.
 * @param {EmailBinding | null | undefined} binding
 * @param {Mail} mail
 * @param {{ secrets?: readonly (string | null | undefined)[] }} [options]
 * @returns {Promise<SendOutcome>}
 */
export function sendEmail(binding: EmailBinding | null | undefined, mail: Mail, options?: {
    secrets?: readonly (string | null | undefined)[];
}): Promise<SendOutcome>;
/**
 * The binding's code for a recipient on the account's suppression list, with the sending domain's "Drop suppressed
 * recipients" setting off, its default (developers.cloudflare.com/email-service/configuration/domains/). The entry comes
 * from a hard bounce, a spam complaint or a manual suppression; a hard bounce for a mailbox or domain that does not
 * exist, and a complaint, never expire (developers.cloudflare.com/email-service/concepts/suppressions/).
 */
export const RECIPIENT_SUPPRESSED: "E_RECIPIENT_SUPPRESSED";
/** A send that did not go out, thrown by a caller that must fail with it. Its message holds only the code. */
export class EmailNotSent extends Error {
    /** @param {string} code */
    constructor(code: string);
    code: string;
}
/**
 * An address as the binding takes it: a bare address, or one with a display name.
 */
export type MailAddress = string | {
    email: string;
    name?: string;
};
/**
 * One mail, in the binding's structured form (EmailMessageBuilder).
 */
export type Mail = {
    from: MailAddress;
    to: MailAddress | MailAddress[];
    subject: string;
    text?: string | undefined;
    html?: string | undefined;
    replyTo?: MailAddress | undefined;
    /**
     * Custom headers on Email Service's allowlist (List-Unsubscribe, ...).
     */
    headers?: Record<string, string> | undefined;
};
/**
 * The send_email binding (SendEmail in
 */
export type EmailBinding = {
    send(message: never): Promise<unknown>;
};
/**
 * What a send came back with. `code` is the binding's own (E_SENDER_NOT_VERIFIED, ...), `not_configured` for a missing
 * binding, sender or recipient, `header_line_break` for an address holding a line break, or `unknown`. `error` has
 * every secret and recipient cut out.
 */
export type SendOutcome = {
    sent: true;
    messageId: string | null;
} | {
    sent: false;
    code: string;
    error: string;
};
