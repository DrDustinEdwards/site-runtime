/**
 * D1's statement limits, written once. D1 refuses a statement with more than 100 bound parameters ("too many SQL
 * variables", https://developers.cloudflare.com/d1/platform/limits/). An IN list built from data goes through inList,
 * one JSON parameter at any length; a multi-row insert is cut to fit with chunked and rowsPerInsert. LIKE patterns built from what someone typed are escaped here too, so a `%` or
 * `_` in a search box matches itself instead of everything. Each was a copy, or missing, in five sites (the
 * 2026-11-11 third audit pass).
 */
import { and, eq, lt, or, sql } from "drizzle-orm";

/**
 * `column IN (the values)` bound as ONE parameter: the values travel as a JSON array that `json_each` opens
 * (https://developers.cloudflare.com/d1/sql-api/query-json/), so the list can be any length, the statement stays one
 * statement (an UPDATE or DELETE stays atomic, unlike a chunked loop), and SQLite still uses the column's index for
 * the IN subquery. An empty list matches nothing, as Drizzle's inArray does. Values are strings or numbers.
 * @param {import("drizzle-orm").SQLWrapper} column
 * @param {readonly (string | number)[]} values
 */
export function inList(column, values) {
  return sql`${column} IN (SELECT value FROM json_each(${JSON.stringify(values)}))`;
}

/**
 * `column NOT IN (the values)`, bound as one parameter like inList. An empty list matches every row.
 * @param {import("drizzle-orm").SQLWrapper} column
 * @param {readonly (string | number)[]} values
 */
export function notInList(column, values) {
  return sql`${column} NOT IN (SELECT value FROM json_each(${JSON.stringify(values)}))`;
}

/** D1's ceiling on bound parameters in one statement. */
export const D1_MAX_BOUND_PARAMS = 100;

/** The longest IN list, leaving room for the statement's other parameters. */
export const IN_LIST_CHUNK = 90;

/**
 * `items` in slices of at most `size`, in order.
 * @template T
 * @param {readonly T[]} items
 * @param {number} [size]
 * @returns {T[][]}
 */
export function chunked(items, size = IN_LIST_CHUNK) {
  if (!Number.isInteger(size) || size < 1)
    throw new RangeError(`chunk size must be a positive integer, got ${size}`);
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Runs `run` once per slice of `items`, one after another, and returns every slice's rows in order. An empty
 * `items` runs nothing and returns `[]`, so `inArray` never sees an empty list.
 * @template T, R
 * @param {readonly T[]} items
 * @param {(part: T[]) => Promise<readonly R[]>} run
 * @param {number} [size]
 * @returns {Promise<R[]>}
 */
export async function inChunks(items, run, size = IN_LIST_CHUNK) {
  /** @type {R[]} */
  const rows = [];
  for (const part of chunked(items, size)) rows.push(...(await run(part)));
  return rows;
}

/**
 * How many rows one INSERT may carry when every column is a bound parameter.
 * @param {number} columns
 */
export function rowsPerInsert(columns) {
  if (!Number.isInteger(columns) || columns < 1)
    throw new RangeError(`column count must be a positive integer, got ${columns}`);
  return Math.max(1, Math.floor(D1_MAX_BOUND_PARAMS / columns));
}

/**
 * `text` with `\`, `%` and `_` escaped by a backslash, for a LIKE pattern that ends `ESCAPE '\'`. SQLite gives no
 * character a default escape meaning, so the ESCAPE clause is required; likeContains and likeStartsWith add it.
 * @param {string} text
 */
export function escapeLike(text) {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * `column LIKE '%text%' ESCAPE '\'`: rows whose column holds `text` as typed (ASCII case-insensitive, as SQLite's
 * LIKE is).
 * @param {import("drizzle-orm").SQLWrapper} column
 * @param {string} text
 */
export function likeContains(column, text) {
  return sql`${column} LIKE ${`%${escapeLike(text)}%`} ESCAPE '\\'`;
}

/**
 * `column LIKE 'text%' ESCAPE '\'`: rows whose column starts with `text`, where `_` and `%` in `text` are literal.
 * @param {import("drizzle-orm").SQLWrapper} column
 * @param {string} text
 */
export function likeStartsWith(column, text) {
  return sql`${column} LIKE ${`${escapeLike(text)}%`} ESCAPE '\\'`;
}

/**
 * A page cursor for a list ordered newest first by a time and then by id: `<ms>.<id>`. A time alone skips every row
 * that shares the millisecond of the page's last row; the id breaks the tie, so each row is on exactly one page.
 * @param {number} at the last row's time in ms
 * @param {string} id the last row's id
 */
export function encodeCursor(at, id) {
  return `${Math.trunc(at)}.${id}`;
}

/**
 * The time and id in a cursor from encodeCursor, or null when `text` is not one (so a bad cursor reads as the
 * first page, never as an error page).
 * @param {string | null | undefined} text
 * @returns {{ at: number, id: string } | null}
 */
export function decodeCursor(text) {
  const match = /^(\d{1,16})\.(.{1,128})$/s.exec(text ?? "");
  if (!match) return null;
  const at = Number(match[1]);
  return Number.isSafeInteger(at) ? { at, id: /** @type {string} */ (match[2]) } : null;
}

/**
 * The rows after a cursor in `ORDER BY at DESC, id DESC`: `at < value OR (at = value AND id < id)`. `at` is passed as
 * the time column takes it (a Date for a timestamp column), so Drizzle maps it as it maps any value of that column.
 * @param {import("drizzle-orm").Column} atColumn
 * @param {import("drizzle-orm").Column} idColumn
 * @param {unknown} at
 * @param {string} id
 */
export function olderThan(atColumn, idColumn, at, id) {
  return /** @type {import("drizzle-orm").SQL} */ (
    or(lt(atColumn, at), and(eq(atColumn, at), lt(idColumn, id)))
  );
}
