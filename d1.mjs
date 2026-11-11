/**
 * D1's statement limits, written once. D1 refuses a statement with more than 100 bound parameters ("too many SQL
 * variables", https://developers.cloudflare.com/d1/platform/limits/), so every IN list and every multi-row insert
 * built from data is cut to fit here. LIKE patterns built from what someone typed are escaped here too, so a `%` or
 * `_` in a search box matches itself instead of everything. Each was a copy, or missing, in five sites (the
 * 2026-11-11 third audit pass).
 */
import { sql } from "drizzle-orm";

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
