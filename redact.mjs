/**
 * Secret redaction for text a Worker relays from somewhere it does not control: a CI log handed to an agent, an error
 * body from an outside API. Moved from Capsid (src/redact.ts), which redacts the CI logs capsid_inspect_repo returns.
 *
 * A CI log carries whatever the workflow echoed: a token a step printed by accident, an Authorization header from a
 * verbose curl, a key file cat'd while debugging. Each rule replaces the secret, never the line, with
 * [REDACTED:<kind>], so the reader still sees where it was and what kind it was. Order matters: the specific shapes run
 * first, so a GitHub token in `GITHUB_TOKEN=ghp_...` is named github-token rather than the generic assignment.
 *
 * This errs toward over-redacting. A false positive costs a reader one value; a false negative hands a credential to an
 * agent. A log line a site writes about itself goes through log.mjs's scrubText instead, which also cuts emails and URL
 * queries and leaves prose alone.
 *
 * @typedef {"private-key" | "anthropic-key" | "stripe-key" | "jwt" | "github-token" | "slack-token" | "aws-access-key-id" | "auth" | "assignment" | "high-entropy"} RedactionKind
 */

/**
 * The secret shapes log.mjs's scrubText cuts too, defined once here and shared: a PEM or PGP private key block (to the
 * end of the text when it is cut off; its \1 and \2 are its own groups), an Anthropic key, Stripe secret, restricted
 * and webhook-signing keys, a Slack token or webhook URL and an AWS access key id.
 */
export const SECRET_SHAPES = {
  privateKey:
    /-----BEGIN ([A-Z0-9 ]*?)PRIVATE KEY( BLOCK)?-----[\s\S]*?(?:-----END \1PRIVATE KEY\2-----|$)/g,
  anthropicKey: /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
  stripeKey: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]+|\bwhsec_[A-Za-z0-9]+/g,
  slackToken: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  slackWebhook: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g,
  awsAccessKeyId: /\b(?:AKIA|ASIA|ABIA|ACCA|AGPA|AIDA|AIPA|ANPA|ANVA|AROA)[A-Z0-9]{16}\b/g,
};

/** @param {RedactionKind} kind */
const marker = (kind) => `[REDACTED:${kind}]`;

/** @typedef {{ kind: RedactionKind, pattern: RegExp, replace?: (match: string, ...groups: string[]) => string }} Rule */

/**
 * The rules in the order they run, built on first redact(): a bundle that imports only SECRET_SHAPES (log.mjs does)
 * leaves them out.
 * @returns {Rule[]}
 */
function redactionRules() {
  // A value the generic patterns may take: no whitespace, quote, separator or ampersand,
  // and never an earlier marker, so a redacted value is not redacted twice under a
  // vaguer name.
  const VALUE = String.raw`(?!\[REDACTED)[^\s"',;&]{6,}`;

  // Key names whose assigned value is a secret. Deliberately without bare "key" and
  // "auth": "key" is every cache key in a CI log, and "auth" is "author".
  const SECRET_NAME = String.raw`[A-Za-z0-9_.-]*(?:secret|token|passw(?:or)?d|api[_-]?key|access[_-]?key|private[_-]?key|signing[_-]?key|credential)[A-Za-z0-9_.-]*`;

  return [
    // A PEM or PGP private key block, whole. An unterminated block (a log cut mid-key)
    // is redacted to the end of the text rather than left half-shown.
    { kind: "private-key", pattern: SECRET_SHAPES.privateKey },
    // Header and payload are base64url JSON, so both start with eyJ ('{"').
    { kind: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g },
    // Classic (ghp_ personal, gho_ OAuth, ghu_ user-to-server, ghs_ server-to-server,
    // ghr_ refresh) and fine-grained personal access tokens.
    {
      kind: "github-token",
      pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g,
    },
    { kind: "slack-token", pattern: SECRET_SHAPES.slackToken },
    { kind: "slack-token", pattern: SECRET_SHAPES.slackWebhook },
    { kind: "aws-access-key-id", pattern: SECRET_SHAPES.awsAccessKeyId },
    // An Authorization header's value, with its scheme kept. The scheme word is never
    // taken as the value, so a header whose value an earlier rule already redacted is
    // left as it is.
    {
      kind: "auth",
      pattern: new RegExp(
        String.raw`\b(authorization["']?\s*[:=]\s*["']?)((?:bearer|basic|token|digest)\s+)?(?!(?:bearer|basic|token|digest)\s)(${VALUE})`,
        "gi",
      ),
      replace: (_m, lead, scheme) => `${lead}${scheme ?? ""}${marker("auth")}`,
    },
    // A Bearer or Basic credential outside a header. The value must hold a digit or a
    // base64 symbol, so the prose "Bearer tokens" and "Basic authentication" survive.
    {
      kind: "auth",
      pattern: /\b(Bearer|Basic)(\s+)(?=[A-Za-z0-9._~+/-]*[0-9+/=])[A-Za-z0-9._~+/-]{8,}=*/gi,
      replace: (_m, scheme, space) => `${scheme}${space}${marker("auth")}`,
    },
    // Anthropic keys and Stripe secret, restricted and webhook-signing keys: the shapes log.mjs's scrubText knows, after the
    // header rules so a key sent as a Bearer value is named auth.
    { kind: "anthropic-key", pattern: SECRET_SHAPES.anthropicKey },
    { kind: "stripe-key", pattern: SECRET_SHAPES.stripeKey },
    // NAME=value, NAME: value, "name": "value", ?name=value, for a secret-shaped name.
    {
      kind: "assignment",
      pattern: new RegExp(
        String.raw`(?<![A-Za-z0-9_.-])(["']?)(${SECRET_NAME})\1(\s*[:=]\s*)(["']?)(${VALUE})`,
        "gi",
      ),
      replace: (_m, q1, name, sep, q2) => `${q1}${name}${q1}${sep}${q2}${marker("assignment")}`,
    },
    // A long random-looking run shortly after a word like secret, token, key or password,
    // in forms the assignment rule does not cover ("the token is 3f9a...").
    {
      kind: "high-entropy",
      pattern:
        /\b((?:secret|token|key|password|passwd|credential)s?\b[^\n]{0,24}?)([A-Za-z0-9+/_-]{32,}={0,2})/gi,
      replace: (match, lead, run) =>
        looksRandom(run) ? `${lead}${marker("high-entropy")}` : match,
    },
  ];
}

/** @type {Rule[] | undefined} */
let rules;

// A run of 32 or more is random-looking if it is all hex, or mixes letters and digits.
// A long word or a long run of one character is not.
/** @param {string} run */
function looksRandom(run) {
  if (/^[0-9a-f]+$/i.test(run) && /\d/.test(run)) return true;
  return /\d/.test(run) && /[A-Za-z]/.test(run);
}

/**
 * Replaces every secret-shaped value in `text` with [REDACTED:<kind>].
 * @param {string} text
 * @returns {import("./redact.mjs").Redacted}
 */
export function redact(text) {
  /** @type {Partial<Record<RedactionKind, number>>} */
  const redactions = {};
  let out = text;
  rules ??= redactionRules();
  for (const rule of rules) {
    out = out.replace(
      rule.pattern,
      (/** @type {string} */ match, /** @type {unknown[]} */ ...rest) => {
        // rest ends with offset, input (and groups when named); only the captures are strings we pass on.
        const groups = /** @type {string[]} */ (rest.slice(0, -2));
        const replaced = rule.replace ? rule.replace(match, ...groups) : marker(rule.kind);
        if (replaced !== match) redactions[rule.kind] = (redactions[rule.kind] ?? 0) + 1;
        return replaced;
      },
    );
  }
  return { text: out, redactions };
}

/**
 * redact() when only the text is wanted, for a short error body.
 * @param {string} text
 * @returns {string}
 */
export const redactText = (text) => redact(text).text;
