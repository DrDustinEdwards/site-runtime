/**
 * The row a 404 counts against: UTC midnight of `now` in epoch milliseconds, the pathname (a React Router `.data`
 * request as its page) cut to NOT_FOUND_PATH_MAX, and its kind. Never the query.
 * @param {URL} url
 * @param {Date} [now]
 * @returns {{ day: number, path: string, kind: "page" | "probe" }}
 */
export function notFoundKey(url: URL, now?: Date): {
    day: number;
    path: string;
    kind: "page" | "probe";
};
/**
 * The host of a Referer header, only for an http or https URL; "" for none, another scheme or a value that is not a URL.
 * @param {string | null | undefined} referer
 * @returns {string}
 */
export function referrerHost(referer: string | null | undefined): string;
/**
 * @typedef {{ prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown>, all(): Promise<{ results: unknown[] }> } } }} D1Like
 */
/**
 * Counts one 404 now (awaited). `countNotFound` is the call a site makes; this is the write it waits on.
 * @param {D1Like} db
 * @param {URL} url
 * @param {Date} [now]
 * @param {string | null} [referer] the request's Referer header; only its host is kept
 * @returns {Promise<void>}
 */
export function recordNotFound(db: D1Like, url: URL, now?: Date, referer?: string | null): Promise<void>;
/**
 * Counts `response` when it is a 404 to a GET, in `ctx.waitUntil`. Returns nothing and never throws, so a site calls
 * it on its way out: `countNotFound(env.DB, request, response, ctx); return response;`. `db` may be a function, called
 * inside the background write, so a missing binding is logged like any other failure.
 * @param {D1Like | (() => D1Like)} db
 * @param {Request} request
 * @param {Response | { status: number }} response
 * @param {{ waitUntil(promise: Promise<unknown>): void }} ctx
 * @returns {void}
 */
export function countNotFound(db: D1Like | (() => D1Like), request: Request, response: Response | {
    status: number;
}, ctx: {
    waitUntil(promise: Promise<unknown>): void;
}): void;
/**
 * Deletes the rows from before the last `days` UTC days (today counts as one). A site runs it from its cron.
 * @param {D1Like} db
 * @param {{ days?: number, now?: Date }} [options]
 * @returns {Promise<void>}
 */
export function pruneNotFound(db: D1Like, { days, now }?: {
    days?: number;
    now?: Date;
}): Promise<void>;
/**
 * The nightly job that runs pruneNotFound, named "prune-404" on every site (one minute).
 * @param {D1Like} db
 * @param {{ days?: number }} [options]
 * @returns {import("./cron.mjs").CronJob}
 */
export function pruneNotFoundJob(db: D1Like, { days }?: {
    days?: number;
}): import("./cron.mjs").CronJob;
/**
 * The most-hit missing paths of the last `days` UTC days, for an admin screen: each with its kind, its hits and the
 * hosts that linked to it ("" is no referrer), most hits first. Probes are left out unless `includeProbes`; a row
 * counted before the kind column existed is classed by its path.
 * @param {D1Like} db
 * @param {{ days?: number, limit?: number, includeProbes?: boolean, now?: Date }} [options]
 * @returns {Promise<Array<{ path: string, kind: "page" | "probe", hits: number, referrers: Array<{ host: string, hits: number }> }>>}
 */
export function notFoundReport(db: D1Like, { days, limit, includeProbes, now }?: {
    days?: number;
    limit?: number;
    includeProbes?: boolean;
    now?: Date;
}): Promise<Array<{
    path: string;
    kind: "page" | "probe";
    hits: number;
    referrers: Array<{
        host: string;
        hits: number;
    }>;
}>>;
/**
 * Checks one entry and returns it in the table's form, or throws naming what is wrong.
 * @param {{ from: string, to: string, status?: number }} entry
 * @returns {{ from: string, to: string, status: number }}
 */
export function redirectEntry({ from, to, status }: {
    from: string;
    to: string;
    status?: number;
}): {
    from: string;
    to: string;
    status: number;
};
/**
 * The redirect for a request from the site's table, or null. `table` is a list of `{ from, to, status? }` entries or a
 * lookup (sync or async) from a path to its entry, such as `d1Redirects(env.DB)`. A chain (a to b, b to c) is followed
 * to its end, so the reader takes one hop; a loop throws. The query is kept unless the target names its own; a 301 or
 * 302 to a method other than GET and HEAD becomes 308 or 307, so a form body survives. A path target stays on the
 * request's own origin. Sent `private, no-store`, so a row that is removed is not held in a browser.
 * @param {Request} request
 * @param {readonly { from: string, to: string, status?: number }[] | ((path: string) => { to: string, status?: number } | null | undefined | Promise<{ to: string, status?: number } | null | undefined>)} table
 * @returns {Promise<Response | null>}
 */
export function tableRedirect(request: Request, table: readonly {
    from: string;
    to: string;
    status?: number;
}[] | ((path: string) => {
    to: string;
    status?: number;
} | null | undefined | Promise<{
    to: string;
    status?: number;
} | null | undefined>)): Promise<Response | null>;
/**
 * The lookup `tableRedirect` takes, reading the `redirects` table: one indexed read per hop.
 * @param {D1Like | (() => D1Like)} db
 * @returns {(path: string) => Promise<{ to: string, status: number } | null>}
 */
export function d1Redirects(db: D1Like | (() => D1Like)): (path: string) => Promise<{
    to: string;
    status: number;
} | null>;
/**
 * Adds a redirect in one step (the admin's "add a 301" on a 404 row): checks the entry, refuses one that would make a
 * loop, writes it (replacing an earlier row for the same path), and points every row that led to `from` straight at the
 * new target, so no chain grows. Returns the entry written.
 * @param {D1Like} db
 * @param {{ from: string, to: string, status?: number }} entry
 * @param {{ now?: Date }} [options]
 * @returns {Promise<{ from: string, to: string, status: number }>}
 */
export function addRedirect(db: D1Like, entry: {
    from: string;
    to: string;
    status?: number;
}, { now }?: {
    now?: Date;
}): Promise<{
    from: string;
    to: string;
    status: number;
}>;
/**
 * Removes the redirect from a path; nothing when there is none.
 * @param {D1Like} db
 * @param {string} from
 * @returns {Promise<void>}
 */
export function removeRedirect(db: D1Like, from: string): Promise<void>;
/**
 * Every redirect, newest first, for the admin screen.
 * @param {D1Like} db
 * @returns {Promise<Array<{ from: string, to: string, status: number, createdAt: number }>>}
 */
export function listRedirects(db: D1Like): Promise<Array<{
    from: string;
    to: string;
    status: number;
    createdAt: number;
}>>;
/**
 * One missing path in the report: "" as a referrer host is no referrer.
 * @typedef {object} NotFoundReportRow
 * @property {string} path
 * @property {"page" | "probe"} kind
 * @property {number} hits
 * @property {Array<{ host: string; hits: number }>} referrers
 */
/**
 * One redirect: `from` a path, `to` a path or an https URL, `status` 301 (default), 302, 307 or 308.
 * @typedef {object} RedirectEntry
 * @property {string} from
 * @property {string} to
 * @property {number} [status]
 */
/**
 * The lookup from a path to its entry that tableRedirect takes.
 * @typedef {(
 * path: string,
 * ) =>
 * | { to: string; status?: number }
 * | null
 * | undefined
 * | Promise<{ to: string; status?: number } | null | undefined>} RedirectLookup
 */
/** The longest path stored: a crawler probing for exploits sends very long URLs, each a row of that size. */
export const NOT_FOUND_PATH_MAX: 512;
/** The table's name. */
export const NOT_FOUND_TABLE: "page_404_daily";
/** The most 404 writes one isolate has waiting at once; past it a count is dropped, not queued on the database. */
export const NOT_FOUND_MAX_PENDING: 8;
/**
 * The paths exploit scanners ask for, never a page of a site's: WordPress (`/wp-admin`, `/wp-content`, any `/wp-`),
 * server scripts (`.php`, `.asp`, `.jsp`, `.cgi`, `/cgi-bin/`, `/xmlrpc`), dumps and config files (`.sql`, `.bak`,
 * `.env`, `.ini`, `.yml`, `.db`, `/config.json`, `/config/`, `env.js`), dotfiles but `/.well-known/` (`/.env`,
 * `/.git/`), phpMyAdmin and phpinfo, credential files (`credentials.json`, `aws-exports.js`, `appsettings.json`) and
 * AI-key paths (`/openai/`, `/anthropic/`, `/bedrock/`, `/llm/`), archives and leftovers (`.zip`, `.tar.gz`, `.tgz`,
 * `.rar`, `.7z`, `.war`, `.log`, `.old`, `.swp`, `.pem`, `.key`), server pages (`/web.config`, `/server-status`,
 * `/server-info`, `/actuator`) and framework debug and admin paths (`/vendor/phpunit`, `/_profiler`, `/telescope`,
 * `/solr/`, `/owa/`, `/ecp/`, `/boaform`, `/hnap1`). Their rows are kind "probe", so the report leaves them out of the
 * broken links by default.
 */
export const NOT_FOUND_PROBE: RegExp;
/** The migration for a site without the table: it adds it as its next file under `migrations/`. */
export const NOT_FOUND_SQL: "CREATE TABLE IF NOT EXISTS page_404_daily (\n  id TEXT PRIMARY KEY NOT NULL,\n  day INTEGER NOT NULL,\n  path TEXT NOT NULL,\n  referrer_host TEXT NOT NULL DEFAULT '',\n  kind TEXT NOT NULL DEFAULT 'page',\n  hit_count INTEGER DEFAULT 0 NOT NULL\n);\nCREATE UNIQUE INDEX IF NOT EXISTS page_404_daily_day_path_referrer_uq ON page_404_daily (day, path, referrer_host);\n";
/**
 * The migration for a table of the first shape (day, path, hit_count, unique index page_404_daily_day_path_uq): the
 * two columns, and the unique key moved to (day, path, referrer_host). Existing rows become kind "page" with no
 * referrer. Apply it with the version that brings it: the new upsert needs the new key, and the old one needs the old.
 */
export const NOT_FOUND_UPGRADE_SQL: "ALTER TABLE page_404_daily ADD COLUMN referrer_host TEXT NOT NULL DEFAULT '';\nALTER TABLE page_404_daily ADD COLUMN kind TEXT NOT NULL DEFAULT 'page';\nDROP INDEX IF EXISTS page_404_daily_day_path_uq;\nCREATE UNIQUE INDEX IF NOT EXISTS page_404_daily_day_path_referrer_uq ON page_404_daily (day, path, referrer_host);\n";
/** The most distinct rows one UTC day holds; past it a new key is folded into NOT_FOUND_OVERFLOW (OWASP ASVS 5 2.4.1). */
export const NOT_FOUND_DAILY_ROWS: 2000;
/** The path of the row that counts the 404s past the day's cap. */
export const NOT_FOUND_OVERFLOW: "(overflow)";
/**
 * The redirect table: a site's own list of moved paths, so a 404 the report shows is fixed with one row instead of a
 * deploy. `from_path` (the old pathname, no query) is the key; `to_path` is a path on the site or an absolute https URL;
 * `status` is 301, 302, 307 or 308; `created_at` epoch milliseconds. A site adds REDIRECTS_SQL as its next migration.
 */
export const REDIRECTS_SQL: "CREATE TABLE IF NOT EXISTS redirects (\n  from_path TEXT PRIMARY KEY NOT NULL,\n  to_path TEXT NOT NULL,\n  status INTEGER NOT NULL DEFAULT 301,\n  created_at INTEGER NOT NULL\n);\n";
export type D1Like = {
    prepare(sql: string): {
        bind(...values: unknown[]): {
            run(): Promise<unknown>;
            all(): Promise<{
                results: unknown[];
            }>;
        };
    };
};
/**
 * One missing path in the report: "" as a referrer host is no referrer.
 */
export type NotFoundReportRow = {
    path: string;
    kind: "page" | "probe";
    hits: number;
    referrers: Array<{
        host: string;
        hits: number;
    }>;
};
/**
 * One redirect: `from` a path, `to` a path or an https URL, `status` 301 (default), 302, 307 or 308.
 */
export type RedirectEntry = {
    from: string;
    to: string;
    status?: number | undefined;
};
/**
 * The lookup from a path to its entry that tableRedirect takes.
 */
export type RedirectLookup = (path: string) => {
    to: string;
    status?: number;
} | null | undefined | Promise<{
    to: string;
    status?: number;
} | null | undefined>;
