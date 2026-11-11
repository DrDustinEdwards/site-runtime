import type { Column, SQL, SQLWrapper } from "drizzle-orm";

/** `column IN (values)` bound as one JSON parameter (json_each): any length, one statement. Empty matches nothing. */
export function inList(column: SQLWrapper, values: readonly (string | number)[]): SQL;
/** `column NOT IN (values)` bound as one JSON parameter. Empty matches every row. */
export function notInList(column: SQLWrapper, values: readonly (string | number)[]): SQL;
/** D1's ceiling on bound parameters in one statement (100). */
export const D1_MAX_BOUND_PARAMS: number;
/** The longest IN list (90), leaving room for the statement's other parameters. */
export const IN_LIST_CHUNK: number;
/** `items` in slices of at most `size` (default IN_LIST_CHUNK), in order. */
export function chunked<T>(items: readonly T[], size?: number): T[][];
/** `run` once per slice, one after another; every slice's rows in order. Empty `items` runs nothing. */
export function inChunks<T, R>(
  items: readonly T[],
  run: (part: T[]) => Promise<readonly R[]>,
  size?: number,
): Promise<R[]>;
/** How many rows one INSERT may carry when every column is a bound parameter. */
export function rowsPerInsert(columns: number): number;
/** `\`, `%` and `_` escaped by a backslash, for a pattern that ends `ESCAPE '\'`. */
export function escapeLike(text: string): string;
/** `column LIKE '%text%' ESCAPE '\'`, with `text` matched as typed. */
export function likeContains(column: SQLWrapper, text: string): SQL;
/** `column LIKE 'text%' ESCAPE '\'`, with `text` matched as typed. */
export function likeStartsWith(column: SQLWrapper, text: string): SQL;
/** A newest-first page cursor, `<ms>.<id>`: the id breaks ties between rows of the same millisecond. */
export function encodeCursor(at: number, id: string): string;
/** The time and id of a cursor, or null when the text is not one. */
export function decodeCursor(text: string | null | undefined): { at: number; id: string } | null;
/** `at < value OR (at = value AND id < id)`, the rows after a cursor in `ORDER BY at DESC, id DESC`. */
export function olderThan(atColumn: Column, idColumn: Column, at: unknown, id: string): SQL;
