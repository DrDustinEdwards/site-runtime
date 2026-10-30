/**
 * A count of the 404s a site serves, per path, referring host and UTC day, in its D1 (not-found.mjs); Foxhound's
 * page_404_daily table with `referrer_host` and `kind` added.
 */

/** The longest path stored: 512. */
export const NOT_FOUND_PATH_MAX: number;
/** "page_404_daily". */
export const NOT_FOUND_TABLE: "page_404_daily";
/** The paths exploit scanners ask for (wp-admin, any .php, /.env, /.git/, /cgi-bin/, phpMyAdmin): kind "probe". */
export const NOT_FOUND_PROBE: RegExp;
/** The migration for a new site: the table (id, day, path, referrer_host, kind, hit_count), unique on (day, path, referrer_host). */
export const NOT_FOUND_SQL: string;
/** The migration for Foxhound's and txasm's table: adds referrer_host and kind, moves the unique key to (day, path, referrer_host). */
export const NOT_FOUND_UPGRADE_SQL: string;

/** The part of a D1 binding this uses. */
export interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): { run(): Promise<unknown>; all(): Promise<{ results: unknown[] }> };
  };
}

/** UTC midnight of `now` in epoch ms, the pathname (a `.data` request as its page) cut to 512, and its kind; never the query. */
export function notFoundKey(url: URL, now?: Date): { day: number; path: string; kind: "page" | "probe" };
/** The host of an http or https Referer; "" otherwise. */
export function referrerHost(referer: string | null | undefined): string;
/** Counts one 404 for `url` now, awaited; of `referer` only its host is kept. */
export function recordNotFound(db: D1Like, url: URL, now?: Date, referer?: string | null): Promise<void>;
/** Counts a 404 to a GET in `ctx.waitUntil`; never throws, a failed write is logged as not_found_count_failed. */
export function countNotFound(
  db: D1Like | (() => D1Like),
  request: Request,
  response: Response | { status: number },
  ctx: { waitUntil(promise: Promise<unknown>): void },
): void;
/** Deletes the rows from before the last `days` UTC days (default 90, today included). */
export function pruneNotFound(db: D1Like, options?: { days?: number; now?: Date }): Promise<void>;

/** One missing path in the report: "" as a referrer host is no referrer. */
export interface NotFoundReportRow {
  path: string;
  kind: "page" | "probe";
  hits: number;
  referrers: Array<{ host: string; hits: number }>;
}
/** The most-hit missing paths of the last `days` (default 30), at most `limit` (default 50), probes only with `includeProbes`. */
export function notFoundReport(
  db: D1Like,
  options?: { days?: number; limit?: number; includeProbes?: boolean; now?: Date },
): Promise<NotFoundReportRow[]>;
