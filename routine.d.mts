/** Starting a Claude Code routine from a site (routine.mjs). */

export type RoutineConfig = { url: string; token: string; routineId: string };

/** The routine id (`trig_...`) a fire URL names, or null when it is not a routine's /fire URL. */
export function routineId(url: string | undefined): string | null;

/** The fire URL and token, checked: both set and the URL a routine's /fire URL (so the token only goes to Anthropic). */
export function routineConfig(url: string | undefined, token: string | undefined): RoutineConfig | { missing: string };

export type FireResult =
  /** A session started. `sessionUrl` is a claude.ai session URL; when the answer named only one of id or URL, the other is derived. */
  | { ok: true; outcome: "started"; status: number; sessionId: string; sessionUrl: string }
  /** The hourly limit (30 per routine, 100 per account). `retryAfter` is seconds, from Retry-After when it was sent. */
  | { ok: false; outcome: "rate_limited"; retry: true; status: 429; retryAfter?: number; error: string }
  /** 500, 503 `overloaded_error` or another 5xx: try again later. */
  | { ok: false; outcome: "unavailable"; retry: true; status: number; retryAfter?: number; error: string }
  /** No connection was made, so nothing reached Anthropic: safe to try again. */
  | { ok: false; outcome: "unreachable"; retry: true; error: string }
  /** 400, 401, 403, 404 or another 4xx: will not work until something changes (a paused routine, a revoked token, a deleted routine). */
  | { ok: false; outcome: "refused"; retry: false; status: number; error: string }
  /**
   * The request may have reached Anthropic and no usable answer came back (a timeout, a dropped connection, a 2xx that
   * names no session). A session may exist; firing again may start a second one. Never retried.
   */
  | { ok: false; outcome: "unknown"; retry: false; status?: number; error: string };

/**
 * Fire the routine once with `text` (cut to 65,536 characters). Never throws. `retry` is true only when a later fire
 * cannot duplicate a session; the endpoint has no idempotency key.
 */
export function fireRoutine(config: RoutineConfig, text: string, fetcher?: typeof fetch): Promise<FireResult>;

/**
 * What `fireOnce` keeps per job key, as JSON. `firing` is a fire in flight; one older than 10 minutes is reported as
 * `unknown` (its worker died mid-fire). `failed` is a sure non-start whose delete failed, and blocks nothing.
 */
export type FireRecord = { state: "firing" | "fired" | "unknown" | "failed"; at: string; sessionId?: string; sessionUrl?: string; error?: string };

/**
 * Where `fireOnce` keeps its records: a D1 table or a Durable Object, never KV (eventually consistent, so two fires can
 * both read nothing). Values are JSON strings. `add` is required: it writes only when the key is absent and says
 * whether it did (D1: INSERT ... ON CONFLICT DO NOTHING RETURNING), so two simultaneous fires cannot both reserve.
 */
export type FireStore = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<unknown>;
  delete(key: string): Promise<unknown>;
  add(key: string, value: string): Promise<boolean>;
};

export type FireOnceResult =
  | (FireResult & { /** The fire happened but its record could not be written: keep the session URL. */ unrecorded?: string })
  /** Refused without firing: the key was fired before, or its fire is in flight or unknown. */
  | { ok: false; outcome: "already_fired"; retry: false; record: FireRecord; error: string };

/**
 * Fire the routine for one job at most once. The record lives at `routine-fire:<jobKey>`: reserved as `firing` before
 * the POST, then `fired` with the session, or `unknown`; a fire that certainly started nothing (refused, rate limited,
 * unavailable, unreachable) deletes it so the job can be fired again. A key with any record is refused unless `force`
 * is set or the record is older than `refireAfterMs` (default never). Throws when the store has no `add`.
 */
export function fireOnce(
  store: FireStore,
  jobKey: string,
  config: RoutineConfig,
  text: string,
  options?: { fetcher?: typeof fetch; force?: boolean; refireAfterMs?: number; now?: Date },
): Promise<FireOnceResult>;
