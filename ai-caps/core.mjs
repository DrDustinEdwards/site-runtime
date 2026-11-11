/**
 * The budget counter's decisions over a Durable Object's SQL storage, as functions of `sql`, so a Worker that already has a
 * class it cannot rename (dustinedwards.info's AskBudget, which extends the rate limiter) calls them from its own
 * methods and one that has none extends the shell (durable-object.mjs). From dustinedwards.info's workers/ask-budget.ts.
 *
 * NO `await` ANYWHERE: a Durable Object's sequence of reads and writes is atomic only while it is synchronous, which is
 * why this is a Durable Object and not the `ratelimit` binding (eventually consistent, not for accounting) or KV (a
 * read-modify-write that races).
 */

/**
 * The window a use is counted in, as the key it is stored under: the UTC date, or the UTC month.
 * @param {"day" | "month"} window
 * @param {Date} now
 */
export function windowKey(window, now) {
  return now.toISOString().slice(0, window === "month" ? 7 : 10);
}

/**
 * Make the table. The name and columns are dustinedwards.info's, so its stored counts carry over.
 * @param {import("./core.d.mts").SqlLike} sql
 */
export function ensureBudgetTable(sql) {
  sql.exec(`CREATE TABLE IF NOT EXISTS budget (day TEXT PRIMARY KEY, count INTEGER NOT NULL)`);
}

/**
 * Count one use in the window `key` unless `limit` is already reached, and forget every other window.
 * @param {import("./core.d.mts").SqlLike} sql
 * @param {string} key
 * @param {number} limit
 * @returns {{ ok: boolean, spent: number }}
 */
export function consume(sql, key, limit) {
  const current = spent(sql, key);
  if (current >= limit) return { ok: false, spent: current };
  const next = current + 1;
  sql.exec(
    `INSERT INTO budget (day, count) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET count = excluded.count`,
    key,
    next,
  );
  sql.exec(`DELETE FROM budget WHERE day <> ?`, key);
  return { ok: true, spent: next };
}

/**
 * What the window `key` has spent, counting nothing.
 * @param {import("./core.d.mts").SqlLike} sql
 * @param {string} key
 * @returns {number}
 */
export function spent(sql, key) {
  const rows = sql.exec(`SELECT count FROM budget WHERE day = ?`, key).toArray();
  return Number(rows[0]?.count ?? 0);
}

/** @param {import("./core.d.mts").SqlLike} sql */
export function resetBudget(sql) {
  sql.exec(`DELETE FROM budget`);
}
