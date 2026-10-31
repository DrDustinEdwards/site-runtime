/**
 * A count of the 404s a site serves, per path, referring site and UTC day, in the site's D1, so a broken link or a
 * moved page shows up, and where the link to it is (Foxhound's page_404_daily, job J21, moved here; Rank Math's 404
 * Monitor without its personal data). `id` a random UUID, `day` UTC midnight in epoch milliseconds (Drizzle's
 * timestamp_ms), `path`, `referrer_host`, `kind` ("page", or "probe" for an exploit scanner's guess) and `hit_count`,
 * unique on (day, path, referrer_host). Foxhound and txasm, which have the first shape, run NOT_FOUND_UPGRADE_SQL.
 *
 * - Only the pathname is kept, cut to NOT_FOUND_PATH_MAX characters. The query never is: it can carry a token (a magic
 *   link, a reset code, an unsubscribe link), and the table is read by people who should never see one. Of the Referer
 *   only the host of an http or https URL is kept, never its path or query. No user agent or address is stored.
 * - GET only: a POST that 404s is a form aimed at a missing route, not a page someone went looking for.
 * - React Router's data request for a page (`/x.data`, `/_.data` for the home page) counts as that page, so a client
 *   navigation and a document load of the same missing page add to one row.
 * - One upsert, so two 404s at once on one path cannot both insert or lose a hit.
 * - Written in `ctx.waitUntil`, so the count never holds or fails the response. A failed write is logged
 *   (`not_found_count_failed`), since a count that stops in silence is how Foxhound's table sat empty.
 */

import { logEvent } from "./log.mjs";

/** The longest path stored: a crawler probing for exploits sends very long URLs, each a row of that size. */
export const NOT_FOUND_PATH_MAX = 512;

/** The table's name. */
export const NOT_FOUND_TABLE = "page_404_daily";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The paths exploit scanners ask for: WordPress's admin, any `.php`, `/.env`, `/.git/`, `/cgi-bin/`, phpMyAdmin. Their
 * rows are kind "probe", so the report leaves them out of the broken links by default.
 */
export const NOT_FOUND_PROBE = /\/(?:wp-admin|cgi-bin|phpmyadmin)(?:\/|$)|\.php$|\/\.env|\/\.git(?:\/|$)/i;

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
 * The migration for Foxhound's and txasm's table (day, path, hit_count, unique index page_404_daily_day_path_uq): the
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
