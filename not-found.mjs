/**
 * A count of the 404s a site serves, per path per UTC day, in the site's D1, so a broken link or a moved page shows up
 * (Foxhound's page_404_daily, job J21, moved here). The table is Foxhound's exactly, so Foxhound switches without a
 * migration: `id` a random UUID, `day` UTC midnight in epoch milliseconds (Drizzle's timestamp_ms), `path`, and
 * `hit_count`, unique on (day, path).
 *
 * - Only the pathname is kept, cut to NOT_FOUND_PATH_MAX characters. The query never is: it can carry a token (a magic
 *   link, a reset code, an unsubscribe link), and the table is read by people who should never see one. No referrer,
 *   user agent or address is stored.
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

/** The migration: a D1 site adds it as its next file under `migrations/`. Foxhound already has this table. */
export const NOT_FOUND_SQL = `CREATE TABLE IF NOT EXISTS page_404_daily (
  id TEXT PRIMARY KEY NOT NULL,
  day INTEGER NOT NULL,
  path TEXT NOT NULL,
  hit_count INTEGER DEFAULT 0 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS page_404_daily_day_path_uq ON page_404_daily (day, path);
`;

const UPSERT = `INSERT INTO page_404_daily (id, day, path, hit_count) VALUES (?1, ?2, ?3, 1)
ON CONFLICT (day, path) DO UPDATE SET hit_count = hit_count + 1`;

/**
 * The row a 404 counts against: UTC midnight of `now` in epoch milliseconds, and the pathname (a React Router `.data`
 * request as its page) cut to NOT_FOUND_PATH_MAX. Never the query.
 * @param {URL} url
 * @param {Date} [now]
 * @returns {{ day: number, path: string }}
 */
export function notFoundKey(url, now = new Date()) {
  const day = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
  const page = url.pathname.endsWith("/_.data") ? url.pathname.slice(0, -"_.data".length) : url.pathname.replace(/\.data$/, "");
  return { day, path: (page || "/").slice(0, NOT_FOUND_PATH_MAX) };
}

/**
 * @typedef {{ prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown> } } }} D1Like
 */

/**
 * Counts one 404 now (awaited). `countNotFound` is the call a site makes; this is the write it waits on.
 * @param {D1Like} db
 * @param {URL} url
 * @param {Date} [now]
 * @returns {Promise<void>}
 */
export async function recordNotFound(db, url, now = new Date()) {
  const { day, path } = notFoundKey(url, now);
  await db.prepare(UPSERT).bind(crypto.randomUUID(), day, path).run();
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
      .then(() => recordNotFound(typeof db === "function" ? db() : db, url))
      .catch((error) => logEvent("not_found_count_failed", { error }, { level: "error" })),
  );
}
