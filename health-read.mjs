/**
 * Reading a /health answer: what Capsid's watcher, a site's own deploy readiness and a colophon tile make of another
 * Worker's health body. The writer is health.mjs (`healthResponse`): `status` pass, warn or fail, with `checks`. The
 * reader also takes the older bodies that carry only `ok` and `backup.warning`, and Capsid's own ok, degraded or down,
 * so every site is read the same way. No imports: a page's script can read a body too.
 */

/** @type {Record<string, "ok" | "degraded" | "down">} */
const STATUS_OF = {
  ok: "ok",
  degraded: "degraded",
  down: "down",
  pass: "ok",
  warn: "degraded",
  fail: "down",
};

const MAX_SHA_CHARS = 40;
const MAX_PROBLEM_CHARS = 200;
const COUNTS = /^(\d+) of (\d+)$/;

/**
 * What a health value says. A field of the wrong type reads as absent: a site that reports no sha is a finding for
 * whoever wants one, never a crash in the reader. A backup warning or `ok: false` under an ok status reads as degraded,
 * so a 200 that admits a problem is not counted as healthy. Extra fields are ignored.
 * @param {unknown} value the parsed body
 * @returns {import("./health-read.mjs").ParsedHealth}
 */
export function healthOf(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return { status: null, sha: null, problem: null };
  const { status, sha, ok, checks, backup } = /** @type {Record<string, unknown>} */ (value);
  const reasons = failingCheckNames(checks);
  const warning = /** @type {{ warning?: unknown } | null | undefined} */ (backup)?.warning;
  if (typeof warning === "string" && warning) reasons.push(`backup: ${warning}`);
  /** @type {"ok" | "degraded" | "down" | null} */
  let said =
    typeof status === "string" && Object.hasOwn(STATUS_OF, status) ? STATUS_OF[status] : null;
  if (said === null && typeof ok === "boolean") said = ok ? "ok" : "degraded";
  if (said === "ok" && (ok === false || reasons.length > 0)) said = "degraded";
  if (said !== null && said !== "ok" && reasons.length === 0 && ok === false)
    reasons.push("ok: false");
  const problem =
    said === null || said === "ok" || reasons.length === 0
      ? null
      : reasons.join("; ").slice(0, MAX_PROBLEM_CHARS);
  return {
    status: said,
    sha: typeof sha === "string" && sha.length > 0 ? sha.slice(0, MAX_SHA_CHARS) : null,
    problem,
  };
}

/**
 * `healthOf` over a body as text. Anything that is not JSON reads as absent.
 * @param {string | null | undefined} body
 */
export function parseHealth(body) {
  if (!body) return healthOf(null);
  try {
    return healthOf(JSON.parse(body));
  } catch {
    return healthOf(null);
  }
}

/**
 * The names of the checks that are not passing: `status` warn or fail, or `ok === false` in the older format. A
 * check with neither is not failing (`healthChecks` is the fail-closed reading).
 * @param {unknown} checks
 * @returns {string[]}
 */
export function failingCheckNames(checks) {
  if (!Array.isArray(checks)) return [];
  /** @type {string[]} */
  const out = [];
  for (const c of checks) {
    if (!c || typeof c !== "object") continue;
    const { name, status, ok } = /** @type {Record<string, unknown>} */ (c);
    if (typeof name !== "string") continue;
    if (status === "warn" || status === "fail" || ok === false) out.push(name);
  }
  return out;
}

/**
 * The body's checks as rows a reader acts on, failing closed: a body that is not a /health answer has no rows, and a
 * row with no status the format names is a fail. A failing check whose detail is "present of expected" (a drift check)
 * carries the two counts.
 * @param {unknown} body the parsed body
 * @returns {import("./health-read.mjs").HealthRow[]}
 */
export function healthChecks(body) {
  const checks = /** @type {{ checks?: unknown } | null | undefined} */ (body)?.checks;
  if (!Array.isArray(checks)) return [];
  return checks
    .filter((c) => c && typeof c === "object" && typeof c.name === "string")
    .map((c) => {
      /** @type {"pass" | "warn" | "fail"} */
      const status =
        c.status === "pass" || c.status === "warn" || c.status === "fail" ? c.status : "fail";
      const counts =
        status !== "pass" && typeof c.detail === "string" ? COUNTS.exec(c.detail) : null;
      return {
        name: c.name,
        status,
        ok: status === "pass",
        ...(typeof c.detail === "string" ? { detail: c.detail } : {}),
        ...(counts ? { present: Number(counts[1]), expected: Number(counts[2]) } : {}),
      };
    });
}
