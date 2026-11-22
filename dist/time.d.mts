/**
 * The D1 timestamp text of a time, "YYYY-MM-DD HH:MM:SS" in UTC: the inverse of `parseSqlTime`. Throws a RangeError for
 * an invalid date.
 * @param {Date | number | string} value a Date, epoch milliseconds or a date string `new Date` reads
 * @returns {string}
 */
export function toSqlTime(value: Date | number | string): string;
/**
 * Epoch milliseconds of a stored time, or null for null, empty or unreadable. A zoneless "YYYY-MM-DD HH:MM:SS" (with or
 * without the T, seconds or fraction) is UTC; a value carrying Z or an offset keeps it; a bare day is its UTC midnight.
 * @param {string | null | undefined} value
 * @returns {number | null}
 */
export function parseSqlTime(value: string | null | undefined): number | null;
/**
 * A Date from epoch milliseconds, keeping null as null.
 * @param {number | null | undefined} ms
 * @returns {Date | null}
 */
export function toDate(ms: number | null | undefined): Date | null;
/**
 * Epoch milliseconds of a Date, keeping null as null.
 * @param {Date | null | undefined} date
 * @returns {number | null}
 */
export function toMs(date: Date | null | undefined): number | null;
/**
 * The UTC calendar month of a Date as "YYYY-MM": a month bucket, a billing period's key.
 * @param {Date} date
 * @returns {string}
 */
export function monthKey(date: Date): string;
/**
 * The calendar day of a moment in a zone as "YYYY-MM-DD": a day bucket, a once-a-day key, a meeting's own day. Without a
 * zone it is the runtime's (UTC in a Worker, the viewer's in a browser), so a key that must be UTC says "UTC". A string
 * is read as `parseSqlTime` reads it (zoneless is UTC). Throws a RangeError for a value that is not a time.
 * @param {Date | number | string} at a Date, epoch milliseconds or a stored time
 * @param {string} [zone] an IANA zone, such as "UTC" or "America/Chicago"
 * @returns {string}
 */
export function dayKey(at: Date | number | string, zone?: string): string;
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
export function withTimeout<T>(promise: Promise<T>, ms: number, message?: string, onTimeout?: (error: Error) => void): Promise<T>;
