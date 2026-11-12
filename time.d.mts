/** Stored times (time.mjs): D1's zoneless UTC text and nullable epoch milliseconds. */

/** Epoch ms of "YYYY-MM-DD HH:MM:SS" (UTC), an ISO time with its zone, or a bare day; null when absent or unreadable. */
export function parseSqlTime(value: string | null | undefined): number | null;
/** A Date from epoch ms; null stays null. */
export function toDate(ms: number | null | undefined): Date | null;
/** Epoch ms of a Date; null stays null. */
export function toMs(date: Date | null | undefined): number | null;
