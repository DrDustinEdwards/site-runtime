/** Stored times (time.mjs): D1's zoneless UTC text and nullable epoch milliseconds. */

/** The D1 timestamp text of a time, "YYYY-MM-DD HH:MM:SS" in UTC, the inverse of `parseSqlTime`; throws a RangeError for an invalid date. */
export function toSqlTime(value: Date | number | string): string;
/** Epoch ms of "YYYY-MM-DD HH:MM:SS" (UTC), an ISO time with its zone, or a bare day; null when absent or unreadable. */
export function parseSqlTime(value: string | null | undefined): number | null;
/** A Date from epoch ms; null stays null. */
export function toDate(ms: number | null | undefined): Date | null;
/** Epoch ms of a Date; null stays null. */
export function toMs(date: Date | null | undefined): number | null;
/** The UTC calendar month of a Date as "YYYY-MM". */
export function monthKey(date: Date): string;
/** The calendar day of a moment as "YYYY-MM-DD" in `zone` (the runtime's without one); a string reads as `parseSqlTime`; throws a RangeError for a value that is not a time. */
export function dayKey(at: Date | number | string, zone?: string): string;
/** `promise`, or a rejection with `new Error(message)` (default "timed out after <ms> ms") when `ms` pass first; `onTimeout` hears that error first. */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message?: string,
  onTimeout?: (error: Error) => void,
): Promise<T>;
