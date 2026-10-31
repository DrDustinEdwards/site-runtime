/**
 * The counting, apart from the Durable Object so a test can run it on any SQLite. Fixed windows aligned
 * to the epoch, one row per window length. All rules are checked first and none is counted when any is
 * spent, so a refused request costs a read and no write. No `await` anywhere: a Durable Object sequence
 * that spans one is not atomic.
 *
 * @typedef {{ limit: number, windowSeconds: number }} Rule
 * @typedef {{ exec: (query: string, ...bindings: unknown[]) => { toArray: () => any[] } }} Sql
 * @typedef {{ ok: boolean, used: number, limit: number, retryAfterSeconds: number, window: number }} Hit
 */

const TABLE_SQL =
  "CREATE TABLE IF NOT EXISTS rate_window (window_seconds INTEGER PRIMARY KEY, window_index INTEGER NOT NULL, count INTEGER NOT NULL)";

/** @param {Rule[]} rules */
export function assertRules(rules) {
  if (!Array.isArray(rules) || rules.length === 0) throw new TypeError("rules must be a non-empty array");
  const seen = new Set();
  for (const rule of rules) {
    if (!Number.isInteger(rule?.limit) || rule.limit < 1) throw new TypeError(`limit must be a positive integer, got ${rule?.limit}`);
    if (!Number.isInteger(rule?.windowSeconds) || rule.windowSeconds < 1) throw new TypeError(`windowSeconds must be a positive integer, got ${rule?.windowSeconds}`);
    if (seen.has(rule.windowSeconds)) throw new TypeError(`two rules share the ${rule.windowSeconds} second window`);
    seen.add(rule.windowSeconds);
  }
}

/**
 * Seconds left in the window containing `nowMs`, rounded up, so a client that waits that long is
 * in the next window.
 * @param {number} windowIndex
 * @param {number} windowSeconds
 * @param {number} nowMs
 */
export function secondsLeft(windowIndex, windowSeconds, nowMs) {
  return Math.max(1, Math.ceil(((windowIndex + 1) * windowSeconds * 1000 - nowMs) / 1000));
}

/**
 * Counts one use against every rule unless one is spent. When one is spent the answer is that rule's
 * (the one that frees up last, if several), and nothing is written.
 *
 * @param {Sql} sql
 * @param {Rule[]} rules
 * @param {number} nowMs
 * @returns {Hit}
 */
export function hitRules(sql, rules, nowMs) {
  const state = windows(sql, rules, nowMs);
  const refused = spentHit(state, nowMs);
  if (refused) return refused;

  for (const s of state) {
    sql.exec(
      "INSERT INTO rate_window (window_seconds, window_index, count) VALUES (?, ?, ?) ON CONFLICT(window_seconds) DO UPDATE SET window_index = excluded.window_index, count = excluded.count",
      s.rule.windowSeconds,
      s.windowIndex,
      s.used + 1,
    );
  }
  // Report the rule closest to its limit, so a caller can show the tightest budget.
  const tightest = state.reduce((a, b) => (a.rule.limit - a.used <= b.rule.limit - b.used ? a : b));
  return {
    ok: true,
    used: tightest.used + 1,
    limit: tightest.rule.limit,
    retryAfterSeconds: secondsLeft(tightest.windowIndex, tightest.rule.windowSeconds, nowMs),
    window: tightest.rule.windowSeconds,
  };
}

/**
 * Whether `rules` are spent, counting nothing: hitRules' answer without its write, for a limit that counts only
 * failures (the caller peeks before the attempt and hits after a failed one). `used` is the count so far.
 *
 * @param {Sql} sql
 * @param {Rule[]} rules
 * @param {number} nowMs
 * @returns {Hit}
 */
export function peekRules(sql, rules, nowMs) {
  const state = windows(sql, rules, nowMs);
  const refused = spentHit(state, nowMs);
  if (refused) return refused;
  const tightest = state.reduce((a, b) => (a.rule.limit - a.used <= b.rule.limit - b.used ? a : b));
  return {
    ok: true,
    used: tightest.used,
    limit: tightest.rule.limit,
    retryAfterSeconds: secondsLeft(tightest.windowIndex, tightest.rule.windowSeconds, nowMs),
    window: tightest.rule.windowSeconds,
  };
}

/** Each rule's window and its count so far. @param {Sql} sql @param {Rule[]} rules @param {number} nowMs */
function windows(sql, rules, nowMs) {
  assertRules(rules);
  sql.exec(TABLE_SQL);
  return rules.map((rule) => {
    const windowIndex = Math.floor(nowMs / 1000 / rule.windowSeconds);
    const row = sql.exec("SELECT window_index, count FROM rate_window WHERE window_seconds = ?", rule.windowSeconds).toArray()[0];
    const used = row && row.window_index === windowIndex ? row.count : 0;
    return { rule, windowIndex, used };
  });
}

/**
 * The refusal when a rule is spent (the one that frees up last, if several), else null.
 * @param {ReturnType<typeof windows>} state
 * @param {number} nowMs
 * @returns {Hit | null}
 */
function spentHit(state, nowMs) {
  const spent = state.filter((s) => s.used >= s.rule.limit);
  if (spent.length === 0) return null;
  const last = spent.reduce((a, b) =>
    secondsLeft(a.windowIndex, a.rule.windowSeconds, nowMs) >= secondsLeft(b.windowIndex, b.rule.windowSeconds, nowMs) ? a : b,
  );
  return {
    ok: false,
    used: last.used,
    limit: last.rule.limit,
    retryAfterSeconds: secondsLeft(last.windowIndex, last.rule.windowSeconds, nowMs),
    window: last.rule.windowSeconds,
  };
}

/**
 * The moment the longest window ends, when an idle instance can forget everything.
 * @param {Rule[]} rules
 * @param {number} nowMs
 */
export function idleDeadline(rules, nowMs) {
  return Math.max(...rules.map((r) => (Math.floor(nowMs / 1000 / r.windowSeconds) + 1) * r.windowSeconds * 1000));
}

/**
 * Forgets the windows that have ended and says when the rest end, or null when nothing is left. An
 * alarm that fires early, or against a clock that moved, leaves a live window alone.
 *
 * @param {Sql} sql
 * @param {number} nowMs
 * @returns {number | null}
 */
export function purgeExpired(sql, nowMs) {
  sql.exec(TABLE_SQL);
  sql.exec("DELETE FROM rate_window WHERE (window_index + 1) * window_seconds * 1000 <= ?", nowMs);
  const rows = sql.exec("SELECT MAX((window_index + 1) * window_seconds * 1000) AS ends FROM rate_window").toArray();
  return rows[0]?.ends ?? null;
}
