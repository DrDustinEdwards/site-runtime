/**
 * `text` with an apostrophe in front when a spreadsheet would read it as a formula; a plain number is left alone.
 * @param {string} text
 */
export function guardFormula(text: string): string;
/**
 * One field: null and undefined empty, a list its items joined with "; ", guarded, then quoted when it needs it.
 * @param {unknown} value
 */
export function csvCell(value: unknown): string;
/**
 * @param {readonly unknown[]} cells
 */
export function csvRow(cells: readonly unknown[]): string;
/**
 * @param {readonly string[]} header
 * @param {Iterable<readonly unknown[]>} rows
 */
export function toCsv(header: readonly string[], rows: Iterable<readonly unknown[]>): string;
/**
 * Records as a file: the columns are `columns`, or the first record's keys in order; a missing key is an empty cell.
 * @param {readonly Readonly<Record<string, unknown>>[]} records
 * @param {readonly string[]} [columns]
 */
export function recordsCsv(records: readonly Readonly<Record<string, unknown>>[], columns?: readonly string[]): string;
/**
 * The fields of a CSV text, record by record (RFC 4180, and forgiving): a byte order mark is dropped, CRLF, LF and a
 * lone CR each end a record, a quoted field may hold commas, quotes and line breaks, and a blank last line is not a
 * record. Fields are not trimmed.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text: string): string[][];
/**
 * A download answer: ./r2-object attachmentResponse with the CSV type (attachment with this file name, nosniff,
 * no-store, so an export of private rows is never cached by a heuristic); `init` adds status and headers, and its
 * Cache-Control replaces no-store for an export meant to be shared.
 * @param {string} csv
 * @param {string} filename
 * @param {ResponseInit} [init]
 */
export function csvResponse(csv: string, filename: string, init?: ResponseInit): Response;
/**
 * One cell's value: a list is joined with "; "; null and undefined are empty; any other object is String()ed.
 * @typedef {| string
 * | number
 * | bigint
 * | boolean
 * | Date
 * | null
 * | undefined
 * | readonly (string | number)[]} CsvValue
 */
/** The Content-Type of a CSV answer. */
export const CSV_CONTENT_TYPE: "text/csv; charset=utf-8";
/**
 * One cell's value: a list is joined with "; "; null and undefined are empty; any other object is String()ed.
 */
export type CsvValue = string | number | bigint | boolean | Date | null | undefined | readonly (string | number)[];
