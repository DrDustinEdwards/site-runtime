/**
 * A count of the 404s a site serves, per path, referring host and UTC day, in its D1 (not-found.mjs): the
 * page_404_daily table with `referrer_host` and `kind`.
 */

/** The longest path stored: 512. */
export const NOT_FOUND_PATH_MAX: number;
/** "page_404_daily". */
export const NOT_FOUND_TABLE: "page_404_daily";
/**
 * The paths exploit scanners ask for (any /wp-, server scripts, .sql, .bak, .env and other config files, /config.json,
 * dotfiles but /.well-known/, /cgi-bin/, phpMyAdmin, credential files, AI-key paths, archives such as .zip and .tar.gz,
 * /web.config, /server-status, /actuator and framework debug paths): kind "probe".
 */
export const NOT_FOUND_PROBE: RegExp;
/** The migration for a new site: the table (id, day, path, referrer_host, kind, hit_count), unique on (day, path, referrer_host). */
export const NOT_FOUND_SQL: string;
/** The migration for a table of the first shape: adds referrer_host and kind, moves the unique key to (day, path, referrer_host). */
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

/** The migration for the redirect table: redirects (from_path primary key, to_path, status, created_at). */
export const REDIRECTS_SQL: string;
/** One redirect: `from` a path, `to` a path or an https URL, `status` 301 (default), 302, 307 or 308. */
export interface RedirectEntry {
  from: string;
  to: string;
  status?: number;
}
/** Checks an entry and returns it in the table's form (no trailing slash, status set); throws naming what is wrong. */
export function redirectEntry(entry: RedirectEntry): { from: string; to: string; status: number };
/** The lookup from a path to its entry that tableRedirect takes. */
export type RedirectLookup = (path: string) => { to: string; status?: number } | null | undefined | Promise<{ to: string; status?: number } | null | undefined>;
/**
 * The redirect for a request from the site's table (a list or a lookup), a chain followed to its end, the query kept,
 * 301/302 turned to 308/307 for a method other than GET and HEAD, sent private, no-store; null when the path is not in it.
 */
export function tableRedirect(request: Request, table: readonly RedirectEntry[] | RedirectLookup): Promise<Response | null>;
/** The lookup over the `redirects` table. */
export function d1Redirects(db: D1Like | (() => D1Like)): (path: string) => Promise<{ to: string; status: number } | null>;
/** Adds or replaces a redirect in one step, refusing a loop and pointing rows that led to `from` at the new target. */
export function addRedirect(db: D1Like, entry: RedirectEntry, options?: { now?: Date }): Promise<{ from: string; to: string; status: number }>;
/** Removes the redirect from a path. */
export function removeRedirect(db: D1Like, from: string): Promise<void>;
/** Every redirect, newest first. */
export function listRedirects(db: D1Like): Promise<Array<{ from: string; to: string; status: number; createdAt: number }>>;
