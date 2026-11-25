/**
 * What a health value says. A field of the wrong type reads as absent: a site that reports no sha is a finding for
 * whoever wants one, never a crash in the reader. A backup warning or `ok: false` under an ok status reads as degraded,
 * so a 200 that admits a problem is not counted as healthy. Extra fields are ignored.
 * @param {unknown} value the parsed body
 * @returns {ParsedHealth}
 */
export function healthOf(value: unknown): ParsedHealth;
/**
 * `healthOf` over a body as text. Anything that is not JSON reads as absent.
 * @param {string | null | undefined} body
 * @returns {ParsedHealth}
 */
export function parseHealth(body: string | null | undefined): ParsedHealth;
/**
 * The names of the checks that are not passing: `status` warn or fail, or `ok === false` in the older format. A
 * check with neither is not failing (`healthChecks` is the fail-closed reading).
 * @param {unknown} checks
 */
export function failingCheckNames(checks: unknown): string[];
/**
 * The body's checks as rows a reader acts on, failing closed: a body that is not a /health answer has no rows, and a
 * row with no status the format names is a fail. A failing check whose detail is "present of expected" (a drift check)
 * carries the two counts.
 * @param {unknown} body the parsed body
 * @returns {HealthRow[]}
 */
export function healthChecks(body: unknown): HealthRow[];
/**
 * Reading a /health answer (health-read.mjs): the family format, the older `ok` bodies and Capsid's own.
 */
export type ParsedHealth = {
    /**
     * Null when the body says nothing about health: no status the format names and no `ok` boolean.
     */
    status: "ok" | "degraded" | "down" | null;
    /**
     * The deployed commit, or null when the body reports none.
     */
    sha: string | null;
    /**
     * Why the status is not ok: the failing checks' names and the backup warning; null when there is nothing to say.
     */
    problem: string | null;
};
export type HealthRow = {
    name: string;
    status: "pass" | "warn" | "fail";
    ok: boolean;
    detail?: string | undefined;
    /**
     * A failing drift check's "present of expected" counts.
     */
    present?: number | undefined;
    expected?: number | undefined;
};
