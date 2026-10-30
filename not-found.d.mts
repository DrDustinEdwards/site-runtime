/** A count of the 404s a site serves, per path per UTC day, in its D1 (not-found.mjs); Foxhound's page_404_daily table. */

/** The longest path stored: 512. */
export const NOT_FOUND_PATH_MAX: number;
/** "page_404_daily". */
export const NOT_FOUND_TABLE: "page_404_daily";
/** The migration: the table (id, day in epoch ms, path, hit_count) and its unique index on (day, path). */
export const NOT_FOUND_SQL: string;

/** The part of a D1 binding this uses. */
export interface D1Like {
  prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown> } };
}

/** UTC midnight of `now` in epoch ms, and the pathname (a `.data` request as its page) cut to 512; never the query. */
export function notFoundKey(url: URL, now?: Date): { day: number; path: string };
/** Counts one 404 for `url` now, awaited. */
export function recordNotFound(db: D1Like, url: URL, now?: Date): Promise<void>;
/** Counts a 404 to a GET in `ctx.waitUntil`; never throws, a failed write is logged as not_found_count_failed. */
export function countNotFound(
  db: D1Like | (() => D1Like),
  request: Request,
  response: Response | { status: number },
  ctx: { waitUntil(promise: Promise<unknown>): void },
): void;
