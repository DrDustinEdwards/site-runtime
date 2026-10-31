/**
 * A count of the 404s a site serves, per path, referring site and UTC day, in the site's D1, so a broken link or a
 * moved page shows up, and where the link to it is (Rank Math's 404 Monitor without its personal data). `id` a random UUID, `day` UTC midnight in epoch milliseconds (Drizzle's
 * timestamp_ms), `path`, `referrer_host`, `kind` ("page", or "probe" for an exploit scanner's guess) and `hit_count`,
 * unique on (day, path, referrer_host). A site with the first shape (no referrer or kind) runs NOT_FOUND_UPGRADE_SQL.
 *
 * - Only the pathname is kept, cut to NOT_FOUND_PATH_MAX characters. The query never is: it can carry a token (a magic
 *   link, a reset code, an unsubscribe link), and the table is read by people who should never see one. Of the Referer
 *   only the host of an http or https URL is kept, never its path or query. No user agent or address is stored.
 * - GET only: a POST that 404s is a form aimed at a missing route, not a page someone went looking for.
 * - React Router's data request for a page (`/x.data`, `/_.data` for the home page) counts as that page, so a client
 *   navigation and a document load of the same missing page add to one row.
 * - One upsert, so two 404s at once on one path cannot both insert or lose a hit.
 * - Written in `ctx.waitUntil`, so the count never holds or fails the response. A failed write is logged
 *   (`not_found_count_failed`), since a count that stops in silence leaves the table empty with nobody told.
 */

import { logEvent } from "./log.mjs";

/** The longest path stored: a crawler probing for exploits sends very long URLs, each a row of that size. */
export const NOT_FOUND_PATH_MAX = 512;

/** The table's name. */
export const NOT_FOUND_TABLE = "page_404_daily";

const DAY_MS = 24 * 60 * 60 * 1000;

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
export const NOT_FOUND_PROBE =
  /\.(?:php\d?|aspx?|jsp|cgi|env|ini|sql|bak|db|sqlite|ya?ml)$|\/wp-|\/\.(?!well-known\/)[a-z]|\/xmlrpc|\/cgi-bin(?:\/|$)|phpmyadmin|phpinfo|\/config(?:\/|\.(?:js|json)$)|env\.js$|\/(?:bedrock|anthropic|openai|llm)\/|(?:credential|secret|service-account|aws-exports|appsettings)[^/]*\.[a-z0-9]+$|\.(?:zip|tar|t?gz|bz2|xz|rar|7z|war|log|old|orig|swp|pem|key)$|\/web\.config$|\/server-(?:status|info)$|\/actuator(?:\/|$)|\/vendor\/phpunit|\/_profiler(?:\/|$)|\/telescope(?:\/|$)|\/(?:solr|owa|ecp)\/|\/boaform|\/hnap1$/i;

/** The migration for a site without the table: it adds it as its next file under `migrations/`. */
export const NOT_FOUND_SQL = `CREATE TABLE IF NOT EXISTS page_404_daily (
  id TEXT PRIMARY KEY NOT NULL,
  day INTEGER NOT NULL,
  path TEXT NOT NULL,
  referrer_host TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'page',
  hit_count INTEGER DEFAULT 0 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS page_404_daily_day_path_referrer_uq ON page_404_daily (day, path, referrer_host);
`;

/**
 * The migration for a table of the first shape (day, path, hit_count, unique index page_404_daily_day_path_uq): the
 * two columns, and the unique key moved to (day, path, referrer_host). Existing rows become kind "page" with no
 * referrer. Apply it with the version that brings it: the new upsert needs the new key, and the old one needs the old.
 */
export const NOT_FOUND_UPGRADE_SQL = `ALTER TABLE page_404_daily ADD COLUMN referrer_host TEXT NOT NULL DEFAULT '';
ALTER TABLE page_404_daily ADD COLUMN kind TEXT NOT NULL DEFAULT 'page';
DROP INDEX IF EXISTS page_404_daily_day_path_uq;
CREATE UNIQUE INDEX IF NOT EXISTS page_404_daily_day_path_referrer_uq ON page_404_daily (day, path, referrer_host);
`;

const UPSERT = `INSERT INTO page_404_daily (id, day, path, referrer_host, kind, hit_count) VALUES (?1, ?2, ?3, ?4, ?5, 1)
ON CONFLICT (day, path, referrer_host) DO UPDATE SET hit_count = hit_count + 1`;

/** @param {number} at */
const dayOf = (at) => Math.floor(at / DAY_MS) * DAY_MS;

/**
 * The row a 404 counts against: UTC midnight of `now` in epoch milliseconds, the pathname (a React Router `.data`
 * request as its page) cut to NOT_FOUND_PATH_MAX, and its kind. Never the query.
 * @param {URL} url
 * @param {Date} [now]
 * @returns {{ day: number, path: string, kind: "page" | "probe" }}
 */
export function notFoundKey(url, now = new Date()) {
  const page = url.pathname.endsWith("/_.data") ? url.pathname.slice(0, -"_.data".length) : url.pathname.replace(/\.data$/, "");
  const path = (page || "/").slice(0, NOT_FOUND_PATH_MAX);
  return { day: dayOf(now.getTime()), path, kind: NOT_FOUND_PROBE.test(path) ? "probe" : "page" };
}

/**
 * The host of a Referer header, only for an http or https URL; "" for none, another scheme or a value that is not a URL.
 * @param {string | null | undefined} referer
 * @returns {string}
 */
export function referrerHost(referer) {
  if (!referer) return "";
  try {
    const url = new URL(referer);
    return url.protocol === "http:" || url.protocol === "https:" ? url.hostname.slice(0, 253) : "";
  } catch {
    return "";
  }
}

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
export async function recordNotFound(db, url, now = new Date(), referer = null) {
  const { day, path, kind } = notFoundKey(url, now);
  await db.prepare(UPSERT).bind(crypto.randomUUID(), day, path, referrerHost(referer), kind).run();
}

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
export function countNotFound(db, request, response, ctx) {
  if (response.status !== 404 || request.method !== "GET") return;
  const url = new URL(request.url);
  ctx.waitUntil(
    Promise.resolve()
      .then(() => recordNotFound(typeof db === "function" ? db() : db, url, new Date(), request.headers.get("referer")))
      .catch((error) => logEvent("not_found_count_failed", { error }, { level: "error" })),
  );
}

/**
 * Deletes the rows from before the last `days` UTC days (today counts as one). A site runs it from its cron.
 * @param {D1Like} db
 * @param {{ days?: number, now?: Date }} [options]
 * @returns {Promise<void>}
 */
export async function pruneNotFound(db, { days = 90, now = new Date() } = {}) {
  await db.prepare("DELETE FROM page_404_daily WHERE day < ?1").bind(dayOf(now.getTime()) - (days - 1) * DAY_MS).run();
}

/**
 * The most-hit missing paths of the last `days` UTC days, for an admin screen: each with its kind, its hits and the
 * hosts that linked to it ("" is no referrer), most hits first. Probes are left out unless `includeProbes`; a row
 * counted before the kind column existed is classed by its path.
 * @param {D1Like} db
 * @param {{ days?: number, limit?: number, includeProbes?: boolean, now?: Date }} [options]
 * @returns {Promise<Array<{ path: string, kind: "page" | "probe", hits: number, referrers: Array<{ host: string, hits: number }> }>>}
 */
export async function notFoundReport(db, { days = 30, limit = 50, includeProbes = false, now = new Date() } = {}) {
  const since = dayOf(now.getTime()) - (days - 1) * DAY_MS;
  const { results } = await db
    .prepare(
      `SELECT path, kind, referrer_host, SUM(hit_count) AS hits FROM page_404_daily
WHERE day >= ?1 ${includeProbes ? "" : "AND kind = 'page' "}GROUP BY path, kind, referrer_host`,
    )
    .bind(since)
    .all();
  /** @type {Map<string, { path: string, kind: "page" | "probe", hits: number, referrers: Array<{ host: string, hits: number }> }>} */
  const byPath = new Map();
  for (const row of /** @type {Array<{ path: string, kind: string, referrer_host: string, hits: number }>} */ (results)) {
    const kind = row.kind === "probe" || NOT_FOUND_PROBE.test(row.path) ? "probe" : "page";
    if (kind === "probe" && !includeProbes) continue;
    const entry = byPath.get(row.path) ?? { path: row.path, kind, hits: 0, referrers: [] };
    entry.hits += Number(row.hits);
    const referrer = entry.referrers.find((r) => r.host === row.referrer_host);
    if (referrer) referrer.hits += Number(row.hits);
    else entry.referrers.push({ host: row.referrer_host, hits: Number(row.hits) });
    byPath.set(row.path, entry);
  }
  const report = [...byPath.values()].sort((a, b) => b.hits - a.hits || (a.path < b.path ? -1 : 1)).slice(0, limit);
  for (const entry of report) entry.referrers.sort((a, b) => b.hits - a.hits);
  return report;
}

/**
 * The redirect table: a site's own list of moved paths, so a 404 the report shows is fixed with one row instead of a
 * deploy. `from_path` (the old pathname, no query) is the key; `to_path` is a path on the site or an absolute https URL;
 * `status` is 301, 302, 307 or 308; `created_at` epoch milliseconds. A site adds REDIRECTS_SQL as its next migration.
 */
export const REDIRECTS_SQL = `CREATE TABLE IF NOT EXISTS redirects (
  from_path TEXT PRIMARY KEY NOT NULL,
  to_path TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 301,
  created_at INTEGER NOT NULL
);
`;

const REDIRECT_STATUSES = new Set([301, 302, 307, 308]);
/** A chain longer than this is a loop. */
const MAX_HOPS = 10;

/** A path as the table keys it: the pathname only, one leading slash, no trailing slash but on "/". @param {string} path */
const tablePath = (path) => (path === "/" ? "/" : `/${path.replace(/^\/+/, "").replace(/\/+$/, "")}`);

/**
 * Checks one entry and returns it in the table's form, or throws naming what is wrong.
 * @param {{ from: string, to: string, status?: number }} entry
 * @returns {{ from: string, to: string, status: number }}
 */
export function redirectEntry({ from, to, status = 301 }) {
  if (typeof from !== "string" || !from.startsWith("/") || /[?#]/.test(from)) throw new Error(`redirect: from is a path starting with "/" with no query, not ${JSON.stringify(from)}`);
  if (!REDIRECT_STATUSES.has(status)) throw new Error(`redirect: status is 301, 302, 307 or 308, not ${status}`);
  let target = to;
  if (typeof to !== "string" || to.startsWith("//")) throw new Error(`redirect: to is a path starting with "/" or an https URL, not ${JSON.stringify(to)}`);
  if (/^https:\/\//i.test(to)) new URL(to);
  else if (to.startsWith("/")) target = to.length > 1 && !/[?#]/.test(to) ? tablePath(to) : to;
  else throw new Error(`redirect: to is a path starting with "/" or an https URL, not ${JSON.stringify(to)}`);
  const key = tablePath(from);
  if (key === target) throw new Error(`redirect: ${key} redirects to itself`);
  return { from: key, to: target, status };
}

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
export async function tableRedirect(request, table) {
  const url = new URL(request.url);
  const lookup =
    typeof table === "function"
      ? table
      : (() => {
          const byPath = new Map(table.map((e) => [tablePath(e.from), e]));
          return (/** @type {string} */ path) => byPath.get(path);
        })();
  const path = tablePath(url.pathname);
  /** @type {{ to: string, status?: number } | null | undefined} */
  let hit = await lookup(path);
  if (!hit) return null;
  let status = hit.status ?? 301;
  for (let hops = 0; ; hops++) {
    if (!hit.to.startsWith("/")) break;
    const next = await lookup(tablePath(hit.to.split(/[?#]/)[0]));
    if (!next) break;
    if (hops === MAX_HOPS) throw new Error(`tableRedirect: the redirects from ${path} loop`);
    hit = next;
  }
  const target = hit.to.startsWith("/") ? new URL(`${url.origin}${hit.to.replace(/^\/+/, "/")}`) : new URL(hit.to);
  if (!target.search && !hit.to.includes("?")) target.search = url.search;
  if (request.method !== "GET" && request.method !== "HEAD") status = status === 301 || status === 308 ? 308 : 307;
  return new Response(null, { status, headers: { Location: target.href, "Cache-Control": "private, no-store" } });
}

/**
 * The lookup `tableRedirect` takes, reading the `redirects` table: one indexed read per hop.
 * @param {D1Like | (() => D1Like)} db
 * @returns {(path: string) => Promise<{ to: string, status: number } | null>}
 */
export function d1Redirects(db) {
  return async (path) => {
    const { results } = await (typeof db === "function" ? db() : db).prepare("SELECT to_path, status FROM redirects WHERE from_path = ?1").bind(path).all();
    const row = /** @type {{ to_path: string, status: number } | undefined} */ (results[0]);
    return row ? { to: row.to_path, status: Number(row.status) } : null;
  };
}

/**
 * Adds a redirect in one step (the admin's "add a 301" on a 404 row): checks the entry, refuses one that would make a
 * loop, writes it (replacing an earlier row for the same path), and points every row that led to `from` straight at the
 * new target, so no chain grows. Returns the entry written.
 * @param {D1Like} db
 * @param {{ from: string, to: string, status?: number }} entry
 * @param {{ now?: Date }} [options]
 * @returns {Promise<{ from: string, to: string, status: number }>}
 */
export async function addRedirect(db, entry, { now = new Date() } = {}) {
  const row = redirectEntry(entry);
  if (row.to.startsWith("/")) {
    const lookup = d1Redirects(db);
    let at = row.to;
    for (let hops = 0; hops <= MAX_HOPS; hops++) {
      if (at === row.from) throw new Error(`addRedirect: ${row.from} to ${row.to} would make a loop`);
      const next = await lookup(at);
      if (!next || !next.to.startsWith("/")) break;
      at = tablePath(next.to.split(/[?#]/)[0]);
    }
  }
  await db
    .prepare("INSERT INTO redirects (from_path, to_path, status, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (from_path) DO UPDATE SET to_path = excluded.to_path, status = excluded.status, created_at = excluded.created_at")
    .bind(row.from, row.to, row.status, now.getTime())
    .run();
  await db.prepare("UPDATE redirects SET to_path = ?1 WHERE to_path = ?2 AND from_path <> ?1").bind(row.to, row.from).run();
  return row;
}

/**
 * Removes the redirect from a path; nothing when there is none.
 * @param {D1Like} db
 * @param {string} from
 * @returns {Promise<void>}
 */
export async function removeRedirect(db, from) {
  await db.prepare("DELETE FROM redirects WHERE from_path = ?1").bind(tablePath(from)).run();
}

/**
 * Every redirect, newest first, for the admin screen.
 * @param {D1Like} db
 * @returns {Promise<Array<{ from: string, to: string, status: number, createdAt: number }>>}
 */
export async function listRedirects(db) {
  const { results } = await db.prepare("SELECT from_path, to_path, status, created_at FROM redirects ORDER BY created_at DESC, from_path").bind().all();
  return /** @type {Array<{ from_path: string, to_path: string, status: number, created_at: number }>} */ (results).map((r) => ({ from: r.from_path, to: r.to_path, status: Number(r.status), createdAt: Number(r.created_at) }));
}
