/** Starting a Claude Code routine from a site (routine.mjs). */

export type RoutineConfig = { url: string; token: string };

/** The fire URL and token, checked: both set and the URL a routine's /fire URL (so the token only goes to Anthropic). */
export function routineConfig(url: string | undefined, token: string | undefined): RoutineConfig | { missing: string };

export type FireResult =
  | { ok: true; sessionUrl: string }
  /** Try again later: the hourly limit, or the service briefly down or unreachable. */
  | { ok: false; retry: true; error: string }
  /** Will not work until something changes: a revoked token, a paused or deleted routine. */
  | { ok: false; retry: false; error: string };

/** Fire the routine once with `text` (cut to 65,536 characters). Never throws. */
export function fireRoutine(config: RoutineConfig, text: string, fetcher?: typeof fetch): Promise<FireResult>;
