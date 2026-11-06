/** The one way a Worker sends mail: Cloudflare Email Service's send_email binding (email.mjs). */

/** An address as the binding takes it: a bare address, or one with a display name. */
export type MailAddress = string | { email: string; name?: string };

/** One mail, in the binding's structured form (EmailMessageBuilder). */
export interface Mail {
  from: MailAddress;
  to: MailAddress | MailAddress[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: MailAddress;
  /** Custom headers on Email Service's allowlist (List-Unsubscribe, ...). */
  headers?: Record<string, string>;
}

/** The send_email binding (SendEmail in @cloudflare/workers-types), or any object with its send. */
export interface EmailBinding {
  send(message: Mail): Promise<unknown>;
}

/**
 * What a send came back with. `code` is the binding's own (E_SENDER_NOT_VERIFIED, ...), `not_configured` for a missing
 * binding, sender or recipient, `header_line_break` for an address holding a line break, or `unknown`. `error` has
 * every secret and recipient cut out.
 */
export type SendOutcome = { sent: true; messageId: string | null } | { sent: false; code: string; error: string };

/**
 * Send one mail through the binding. Never throws. An address with a line break is refused, a subject's line breaks
 * fold to a space and a display name loses its quotes. On failure, `secrets` and the recipients are cut out of the
 * error, and one `email_send_failed` line is logged with the code and that error, never the body.
 */
export function sendEmail(
  binding: EmailBinding | null | undefined,
  mail: Mail,
  options?: { secrets?: readonly (string | null | undefined)[] },
): Promise<SendOutcome>;

/** Each of `secrets` cut out of `text`, as `[redacted]`. Empty entries are skipped. */
export function redact(text: string, secrets?: readonly (string | null | undefined)[]): string;
