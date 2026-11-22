/**
 * `column IN (the values)` bound as ONE parameter: the values travel as a JSON array that `json_each` opens
 * (https://developers.cloudflare.com/d1/sql-api/query-json/), so the list can be any length, the statement stays one
 * statement (an UPDATE or DELETE stays atomic, unlike a chunked loop), and SQLite still uses the column's index for
 * the IN subquery. An empty list matches nothing, as Drizzle's inArray does. Values are strings or numbers.
 * @param {import("drizzle-orm").SQLWrapper} column
 * @param {readonly (string | number)[]} values
 */
export function inList(column: import("drizzle-orm").SQLWrapper, values: readonly (string | number)[]): import("drizzle-orm").SQL<any>;
/**
 * `column NOT IN (the values)`, bound as one parameter like inList. An empty list matches every row.
 * @param {import("drizzle-orm").SQLWrapper} column
 * @param {readonly (string | number)[]} values
 */
export function notInList(column: import("drizzle-orm").SQLWrapper, values: readonly (string | number)[]): import("drizzle-orm").SQL<any>;
/**
 * `items` in slices of at most `size`, in order.
 * @template T
 * @param {readonly T[]} items
 * @param {number} [size]
 * @returns {T[][]}
 */
export function chunked<T>(items: readonly T[], size?: number): T[][];
/**
 * How many rows one INSERT may carry when every column is a bound parameter.
 * @param {number} columns
 */
export function rowsPerInsert(columns: number): number;
/**
 * `text` with `\`, `%` and `_` escaped by a backslash, for a LIKE pattern that ends `ESCAPE '\'`. SQLite gives no
 * character a default escape meaning, so the ESCAPE clause is required; likeContains and likeStartsWith add it.
 * @param {string} text
 */
export function escapeLike(text: string): string;
/**
 * `column LIKE '%text%' ESCAPE '\'`: rows whose column holds `text` as typed (ASCII case-insensitive, as SQLite's
 * LIKE is).
 * @param {import("drizzle-orm").SQLWrapper} column
 * @param {string} text
 */
export function likeContains(column: import("drizzle-orm").SQLWrapper, text: string): import("drizzle-orm").SQL<any>;
/**
 * `column LIKE 'text%' ESCAPE '\'`: rows whose column starts with `text`, where `_` and `%` in `text` are literal.
 * @param {import("drizzle-orm").SQLWrapper} column
 * @param {string} text
 */
export function likeStartsWith(column: import("drizzle-orm").SQLWrapper, text: string): import("drizzle-orm").SQL<any>;
/**
 * A page cursor for a list ordered newest first by a time and then by id: `<ms>.<id>`. A time alone skips every row
 * that shares the millisecond of the page's last row; the id breaks the tie, so each row is on exactly one page.
 * @param {number} at the last row's time in ms
 * @param {string} id the last row's id
 */
export function encodeCursor(at: number, id: string): string;
/**
 * The time and id in a cursor from encodeCursor, or null when `text` is not one (so a bad cursor reads as the
 * first page, never as an error page).
 * @param {string | null | undefined} text
 * @returns {{ at: number, id: string } | null}
 */
export function decodeCursor(text: string | null | undefined): {
    at: number;
    id: string;
} | null;
/**
 * The rows after a cursor in `ORDER BY at DESC, id DESC`: `at < value OR (at = value AND id < id)`. `at` is passed as
 * the time column takes it (a Date for a timestamp column), so Drizzle maps it as it maps any value of that column.
 * @param {import("drizzle-orm").Column} atColumn
 * @param {import("drizzle-orm").Column} idColumn
 * @param {unknown} at
 * @param {string} id
 */
export function olderThan(atColumn: import("drizzle-orm").Column, idColumn: import("drizzle-orm").Column, at: unknown, id: string): import("drizzle-orm").SQL;
/** D1's ceiling on bound parameters in one statement. */
export const D1_MAX_BOUND_PARAMS: 100;
/** The longest IN list, leaving room for the statement's other parameters. */
export const IN_LIST_CHUNK: 90;
