/** Reading a /health answer (health-read.mjs): the family format, the older `ok` bodies and Capsid's own. */

export interface ParsedHealth {
  /** Null when the body says nothing about health: no status the format names and no `ok` boolean. */
  status: "ok" | "degraded" | "down" | null;
  /** The deployed commit, or null when the body reports none. */
  sha: string | null;
  /** Why the status is not ok: the failing checks' names and the backup warning; null when there is nothing to say. */
  problem: string | null;
}

export interface HealthRow {
  name: string;
  status: "pass" | "warn" | "fail";
  ok: boolean;
  detail?: string;
  /** A failing drift check's "present of expected" counts. */
  present?: number;
  expected?: number;
}

/** What a parsed health value says; a backup warning or `ok: false` under ok reads as degraded. */
export function healthOf(value: unknown): ParsedHealth;
/** `healthOf` over a body as text; not JSON reads as absent. */
export function parseHealth(body: string | null | undefined): ParsedHealth;
/** The names of the checks whose status is warn or fail, or whose `ok` is false. */
export function failingCheckNames(checks: unknown): string[];
/** The checks as rows, failing closed: no status the format names is a fail. */
export function healthChecks(body: unknown): HealthRow[];
