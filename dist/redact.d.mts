/**
 * Replaces every secret-shaped value in `text` with [REDACTED:<kind>].
 * @param {string} text
 * @returns {Redacted}
 */
export function redact(text: string): Redacted;
export namespace SECRET_SHAPES {
    let privateKey: RegExp;
    let anthropicKey: RegExp;
    let stripeKey: RegExp;
    let slackToken: RegExp;
    let slackWebhook: RegExp;
    let awsAccessKeyId: RegExp;
}
export function redactText(text: string): string;
export type Rule = {
    kind: RedactionKind;
    pattern: RegExp;
    replace?: (match: string, ...groups: string[]) => string;
};
/**
 * Secret redaction for text a Worker relays from somewhere it does not control: a CI log handed to an agent, an error
 * body from an outside API.
 *
 * A CI log carries whatever the workflow echoed: a token a step printed by accident, an Authorization header from a
 * verbose curl, a key file cat'd while debugging. Each rule replaces the secret, never the line, with
 * [REDACTED:<kind>], so the reader still sees where it was and what kind it was. Order matters: the specific shapes run
 * first, so a GitHub token in `GITHUB_TOKEN=ghp_...` is named github-token rather than the generic assignment.
 *
 * This errs toward over-redacting. A false positive costs a reader one value; a false negative hands a credential to an
 * agent. A log line a site writes about itself goes through log.mjs's scrubText instead, which also cuts emails and URL
 * queries and leaves prose alone.
 */
export type RedactionKind = "private-key" | "anthropic-key" | "stripe-key" | "jwt" | "github-token" | "slack-token" | "aws-access-key-id" | "auth" | "assignment" | "high-entropy";
export type Redacted = {
    text: string;
    /**
     * How many values of each kind were replaced; empty when none were.
     */
    redactions: Partial<Record<RedactionKind, number>>;
};
