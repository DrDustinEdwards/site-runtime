/**
 * Times as D1 and the apps store them. SQLite's `datetime('now')` and `CURRENT_TIMESTAMP` write UTC as
 * "YYYY-MM-DD HH:MM:SS" with no zone, which `Date.parse` reads as local time on some engines and not at all on others;
 * Drizzle's timestamp columns hold epoch milliseconds that may be null. One reader for each.
 */

const SQL_TIME =
  /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?$/i;

/**
 * The D1 timestamp text of a time, "YYYY-MM-DD HH:MM:SS" in UTC: the inverse of `parseSqlTime`. Throws a RangeError for
 * an invalid date.
 * @param {Date | number | string} value a Date, epoch milliseconds or a date string `new Date` reads
 * @returns {string}
 */
export function toSqlTime(value) {
  return new Date(value).toISOString().replace("T", " ").slice(0, 19);
}

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

/**
 * The UTC calendar month of a Date as "YYYY-MM": a month bucket, a billing period's key.
 * @param {Date} date
 * @returns {string}
 */
export function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** @type {Map<string, Intl.DateTimeFormat>} */
const dayFormats = new Map();

/**
 * The calendar day of a moment in a zone as "YYYY-MM-DD": a day bucket, a once-a-day key, a meeting's own day. Without a
 * zone it is the runtime's (UTC in a Worker, the viewer's in a browser), so a key that must be UTC says "UTC". A string
 * is read as `parseSqlTime` reads it (zoneless is UTC). Throws a RangeError for a value that is not a time.
 * @param {Date | number | string} at a Date, epoch milliseconds or a stored time
 * @param {string} [zone] an IANA zone, such as "UTC" or "America/Chicago"
 * @returns {string}
 */
export function dayKey(at, zone = "") {
  let format = dayFormats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayFormats.set(zone, format);
  }
  return format.format(typeof at === "string" ? (parseSqlTime(at) ?? Number.NaN) : at);
}

/**
 * `promise`, or a rejection with `new Error(message)` when `ms` pass first; the timer is cleared either way, so a
 * settled call leaves nothing pending. `onTimeout` hears the error before the rejection (to abort the work it raced).
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} [message]
 * @param {(error: Error) => void} [onTimeout]
 * @returns {Promise<T>}
 */
export function withTimeout(promise, ms, message = `timed out after ${ms} ms`, onTimeout) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(message);
      onTimeout?.(error);
      reject(error);
    }, ms);
  });
  return /** @type {Promise<T>} */ (Promise.race([promise, late])).finally(() =>
    clearTimeout(timer),
  );
}
