/** Secret redaction for relayed text (redact.mjs): every secret-shaped value becomes [REDACTED:<kind>]. */

export type RedactionKind =
  | "private-key"
  | "anthropic-key"
  | "stripe-key"
  | "jwt"
  | "github-token"
  | "slack-token"
  | "aws-access-key-id"
  | "auth"
  | "assignment"
  | "high-entropy";

export interface Redacted {
  text: string;
  /** How many values of each kind were replaced; empty when none were. */
  redactions: Partial<Record<RedactionKind, number>>;
}

/** Replaces every secret-shaped value in `text` with [REDACTED:<kind>]; errs toward over-redacting. */
export function redact(text: string): Redacted;
/** redact() when only the text is wanted. */
export function redactText(text: string): string;
