/**
 * The one way a Worker sends mail: Cloudflare Email Service's `send_email` binding
 * (developers.cloudflare.com/email-service/api/send-emails/workers-api/). Every site's sign-in mail, notices and owner
 * alerts go through `sendEmail`, so the guards below hold everywhere:
 *
 * - It never throws. A missing binding, sender or recipient comes back as `not_configured`, a refusal as the binding's
 *   own code (E_SENDER_NOT_VERIFIED, E_RATE_LIMIT_EXCEEDED, ...), each with a message to record or show.
 * - A line break in an address would start a header of the sender's choosing, so a from, to or reply-to (or a custom
 *   header's name or value) holding one is
 *   refused before the binding is called (`header_line_break`); a subject's line breaks are folded to one space.
 * - A link, token or code in the mail signs someone in, and a provider can echo the message in its error. Each of
 *   `secrets`, and every recipient, is cut out of the error before it is returned or logged.
 * - A failure is logged once, as `email_send_failed` with its code and the cut message (./log scrubs it again). The
 *   body is never logged.
 */

import { logEvent } from "./log.mjs";

const LINE_BREAK = /[\r\n]/;

/**
 * The HTML Standard's "valid email address" (html.spec.whatwg.org, input type=email), the rule a browser already
 * applies to an email field, with a dot required in the domain, since a site mails only public addresses. No quotes,
 * angle brackets, spaces or line breaks can pass, and nothing past RFC 5321's 254-character path.
 */
const EMAIL_ADDRESS =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

/**
 * Whether a typed address is one a site may store and mail: the browser's own email-field rule, a dotted domain and at
 * most 254 characters. Trim it first; this does not.
 * @param {unknown} value
 * @returns {value is string}
 */
export function isEmail(value) {
  return typeof value === "string" && value.length <= 254 && EMAIL_ADDRESS.test(value);
}

// The binding's codes are short names (E_SENDER_NOT_VERIFIED); anything else is reported as "unknown".
const CODE = /^[\w.-]{1,64}$/;

/**
 * Each of `secrets` cut out of `text`, as `[redacted]`. Empty entries are skipped.
 * @param {string} text
 * @param {readonly (string | null | undefined)[]} [secrets]
 */
export function redact(text, secrets = []) {
  let out = text;
  for (const secret of secrets) if (secret) out = out.split(secret).join("[redacted]");
  return out;
}

/** @param {unknown} address */
function addressOf(address) {
  if (typeof address === "string") return address.trim();
  if (
    address &&
    typeof address === "object" &&
    "email" in address &&
    typeof address.email === "string"
  )
    return address.email.trim();
  return "";
}

/**
 * The address with a display name made safe: quotes and line breaks dropped, an empty name left out.
 * @param {string | { email: string; name?: string }} address
 */
function cleanAddress(address) {
  if (typeof address === "string") return address.trim();
  const name = (address.name ?? "").replace(/["\r\n]/g, "").trim();
  return name ? { email: address.email.trim(), name } : { email: address.email.trim() };
}

/**
 * @param {string} code
 * @param {string} error
 * @returns {{ sent: false; code: string; error: string }}
 */
function refused(code, error) {
  logEvent(
    "email_send_failed",
    { code, error },
    { level: code === "not_configured" ? "warn" : "error" },
  );
  return { sent: false, code, error };
}

/**
 * Send one mail through the binding.
 * @param {import("./email.d.mts").EmailBinding | null | undefined} binding
 * @param {import("./email.d.mts").Mail} mail
 * @param {{ secrets?: readonly (string | null | undefined)[] }} [options]
 * @returns {Promise<import("./email.d.mts").SendOutcome>}
 */
export async function sendEmail(binding, mail, options = {}) {
  const to = Array.isArray(mail.to) ? mail.to : [mail.to];
  const recipients = to.map(addressOf);
  const from = addressOf(mail.from);
  if (!binding || typeof binding.send !== "function")
    return refused("not_configured", "no send_email binding");
  if (!from) return refused("not_configured", "no sender address");
  if (recipients.length === 0 || recipients.some((r) => !r))
    return refused("not_configured", "no recipient address");
  const names = [mail.from, ...to, ...(mail.replyTo ? [mail.replyTo] : [])].map((a) =>
    typeof a === "string" ? a : a.email,
  );
  const headerText = Object.entries(mail.headers ?? {}).flat();
  if ([...names, ...headerText].some((a) => LINE_BREAK.test(a)))
    return refused("header_line_break", "an address or header holds a line break");
  /** @type {import("./email.d.mts").Mail} */
  const message = {
    ...mail,
    from: cleanAddress(mail.from),
    to: Array.isArray(mail.to) ? mail.to.map(cleanAddress) : cleanAddress(mail.to),
    subject: mail.subject.replace(/[\r\n]+/g, " ").trim(),
  };
  if (mail.replyTo) message.replyTo = cleanAddress(mail.replyTo);
  try {
    const result = /** @type {{ messageId?: unknown } | null | undefined} */ (
      await binding.send(/** @type {never} */ (message))
    );
    return {
      sent: true,
      messageId: typeof result?.messageId === "string" ? result.messageId : null,
    };
  } catch (err) {
    const e = /** @type {{ code?: unknown; message?: unknown }} */ (err ?? {});
    const code = typeof e.code === "string" && CODE.test(e.code) ? e.code : "unknown";
    const text = typeof e.message === "string" ? e.message : String(err);
    return refused(code, redact(text, [...(options.secrets ?? []), ...recipients]).slice(0, 500));
  }
}
