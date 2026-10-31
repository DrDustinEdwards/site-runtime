/** The family's one Anthropic Messages caller: route, timeout, one retry layer, stop reasons, caching, log line (anthropic.mjs). */

/** The `anthropic-version` header every call sends. */
export const ANTHROPIC_VERSION: "2026-10-21";

export type ModelEntry = Readonly<{
  state: "active" | "deprecated" | "retired";
  /** When the model was deprecated (YYYY-MM-DD), or null. */
  deprecated: string | null;
  /** Its set retirement date (YYYY-MM-DD), or null while it has none. */
  retires: string | null;
  /** An active model's "not sooner than" floor from the deprecations page; not a date it stops. */
  notBefore: string | null;
  /** The minimum cacheable prompt, in tokens. */
  cacheMin: number | null;
}>;

/** The models the family calls, from the model-deprecations page as read on MODELS_CHECKED. */
export const MODELS: Readonly<Record<
  "claude-sonnet-5" | "claude-opus-4-8" | "claude-haiku-4-5-20251001" | "claude-sonnet-4-20250514",
  ModelEntry
>>;
export const MODELS_CHECKED: string;

/** The model for each kind of call (C8): name the role, never an id. Each is in MODELS. */
export const MODEL_IDS: Readonly<{ fast: "claude-haiku-4-5-20251001"; standard: "claude-sonnet-5"; deep: "claude-opus-4-8" }>;
/** The deprecations page as Markdown. */
export const DEPRECATIONS_URL: string;
/** The page's model table by id; empty when the page holds no such table. */
export function parseDeprecations(markdown: string): Record<string, Omit<ModelEntry, "cacheMin">>;
/**
 * What is wrong with calling `ids` by the page's `table`: unlisted, deprecated or retired, retiring within 60 days, or
 * MODELS disagreeing with the page. Empty when all is well.
 */
export function deprecationProblems(ids: readonly string[], table: Record<string, { state: string; retires: string | null }>, now?: Date | number): string[];

/** "retired" past its retirement date, "retiring" within 60 days of it, "ok", or "unknown" for an id not in MODELS. */
export function modelStatus(
  id: string,
  now?: Date | number,
): { status: "ok" | "retiring" | "retired" | "unknown"; retires: string | null };

export type FailureKind =
  | "truncated"
  | "context_window"
  | "refusal"
  | "paused"
  | "unexpected_stop"
  | "invalid_output"
  | "spend_limit"
  | "rate_limited"
  | "unavailable"
  | "timeout"
  | "aborted"
  | "rejected";

/** What a reader may be shown for each kind of failure. */
export const FAILURE_TEXT: Readonly<Record<FailureKind, string>>;

/** Outside text as `<data label="...">...</data>`, with `&`, `<` and `>` escaped. State UNTRUSTED_DATA_RULE beside it. */
export function untrusted(label: string, text: string): string;
/** The prompt rule that goes with `untrusted`. */
export const UNTRUSTED_DATA_RULE: string;

export type AnthropicEnv = {
  ANTHROPIC_API_KEY?: string;
  AI_GATEWAY_BASE_URL?: string;
  AI_GATEWAY_TOKEN?: string;
  AI_GATEWAY_ID?: string;
};

/** A Messages request body. `model` and `max_tokens` are required; `temperature`, `top_p`, `top_k` and `stream` are not allowed. */
export type MessagesRequest = {
  model: string;
  max_tokens: number;
  messages: Array<{ role: "user" | "assistant"; content: unknown }>;
  system?: string | Array<Record<string, unknown>>;
  temperature?: never;
  top_p?: never;
  top_k?: never;
  stream?: never;
  [key: string]: unknown;
};

export type CallOptions = {
  /** The feature making the call, logged beside the site and sent in the gateway's metadata. */
  feature?: string;
  /** The deadline for the whole call, retries included (a stream: the longest silence). Default 60,000. */
  timeoutMs?: number;
  /** Attempts in all, the first included. Default 3. */
  maxAttempts?: number;
  /** How many times a `pause_turn` is resent. Default 3. */
  maxPauses?: number;
  /**
   * Unset: automatic caching when the system prompt, tools and messages together reach the model's minimum. true: always (5 min). "1h": always, one
   * hour. false: never. A request with its own block-level `cache_control` gets no top-level one in any case.
   */
  cache?: boolean | "1h";
  /** Beta names for `anthropic-beta`. */
  betas?: string[];
  /** The caller's own abort (a reader who left). */
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  /** The wait between retries; it is raced against `signal`, which it is also given. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** false: no `anthropic_call` log line. */
  log?: boolean;
  /** Gets the log line's record after every call, for metering. Its failure is logged, never thrown. */
  onResult?: (record: CallRecord) => void | Promise<void>;
};

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };

export type CallRecord = Usage & {
  app: string;
  feature: string | null;
  model: string;
  modelStatus?: "retiring" | "retired" | "unknown";
  ok: boolean;
  kind: FailureKind | null;
  status: number | null;
  stopReason: string | null;
  requestId: string | null;
  gatewayLogId: string | null;
  providerType: string | null;
  /** Who answered a failed call through a gateway: the gateway itself or Anthropic (G5). Null on success. */
  source: "gateway" | "anthropic" | null;
  /** The gateway's own error code (2003 rate limited, 2016 and 2017 Guardrails), when it refused. */
  gatewayCode: number | null;
  durationMs: number;
  attempts: number;
  pauses: number;
  streamed: boolean;
};

type Common = { usage: Usage; attempts: number; pauses: number; requestId?: string | null; gatewayLogId?: string | null };

export type MessageAnswer = Common & {
  ok: true;
  /** The text blocks joined. */
  text: string;
  content: unknown[];
  stopReason: "end_turn" | "stop_sequence" | "tool_use";
  stopSequence: string | null;
};

export type MessageFailure = Common & {
  ok: false;
  kind: FailureKind;
  /** A sentence safe to show a reader. Never the provider's message. */
  error: string;
  /** Worth trying again later (rate_limited, unavailable, timeout). */
  retryable: boolean;
  status?: number;
  /** Seconds, from a 429's retry-after that did not fit the deadline. */
  retryAfter?: number;
  /** The provider's error type ("overloaded_error"), for logs. */
  providerType?: string;
  /** For an HTTP failure: the gateway's own refusal (its rate or spend limit, Guardrails) or Anthropic's answer. */
  source?: "gateway" | "anthropic";
  /** The gateway's error code, from its `{ success: false, error: [{ code }] }` body. */
  gatewayCode?: number;
  stopReason?: string | null;
  /** A refusal's policy category. */
  stopDetails?: unknown;
  /** The cut-off or unexpected content, for a caller that chooses to look; never a finished answer. */
  content?: unknown[];
};

export type MessageResult = MessageAnswer | MessageFailure;

/** One Messages call. Never throws for a failed call; throws for a request wrong in code (no key, no max_tokens, sampling parameters). */
export function messages(env: AnthropicEnv, app: string, request: MessagesRequest, options?: CallOptions): Promise<MessageResult>;

/** A call whose answer is JSON matching `schema` (`output_config.format`), parsed into `value`; a reply that does not parse is `invalid_output`. */
export function structured<T = unknown>(
  env: AnthropicEnv,
  app: string,
  request: MessagesRequest,
  schema: Record<string, unknown>,
  options?: CallOptions,
): Promise<(MessageAnswer & { value: T }) | MessageFailure>;

/**
 * A streamed call: text deltas, then one `done` with the result. Retried only before the first byte; `pause_turn` is the
 * `paused` failure. A reader who stops before `done` still gets the call logged and metered, as `aborted`.
 */
export function stream(
  env: AnthropicEnv,
  app: string,
  request: MessagesRequest,
  options?: CallOptions,
): AsyncGenerator<{ type: "text"; delta: string } | { type: "done"; result: MessageResult }, void, unknown>;
