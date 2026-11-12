/**
 * Times as D1 and the apps store them. SQLite's `datetime('now')` and `CURRENT_TIMESTAMP` write UTC as
 * "YYYY-MM-DD HH:MM:SS" with no zone, which `Date.parse` reads as local time on some engines and not at all on others;
 * Drizzle's timestamp columns hold epoch milliseconds that may be null. One reader for each.
 */

const SQL_TIME =
  /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?$/i;

/**
 * Epoch milliseconds of a stored time, or null for null, empty or unreadable. A zoneless "YYYY-MM-DD HH:MM:SS" (with or
 * without the T, seconds or fraction) is UTC; a value carrying Z or an offset keeps it; a bare day is its UTC midnight.
 * @param {string | null | undefined} value
 * @returns {number | null}
 */
export function parseSqlTime(value) {
  if (!value) return null;
  const text = value.trim();
  const zoneless = SQL_TIME.exec(text);
  const iso = zoneless
    ? `${zoneless[1]}T${zoneless[2]}${zoneless[3]?.toUpperCase() ?? "Z"}`
    : /^\d{4}-\d{2}-\d{2}$/.test(text)
      ? `${text}T00:00:00Z`
      : text;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * A Date from epoch milliseconds, keeping null as null.
 * @param {number | null | undefined} ms
 * @returns {Date | null}
 */
export function toDate(ms) {
  return ms == null ? null : new Date(ms);
}

/**
 * Epoch milliseconds of a Date, keeping null as null.
 * @param {Date | null | undefined} date
 * @returns {number | null}
 */
export function toMs(date) {
  return date == null ? null : date.getTime();
}
