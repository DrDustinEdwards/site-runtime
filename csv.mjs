/**
 * CSV for a site's exports, written once: RFC 4180 fields and lines, and the OWASP "CSV Injection" guard
 * (https://owasp.org/www-community/attacks/CSV_Injection). A text cell that a spreadsheet would read as a formula
 * (`=`, `+`, `-`, `@`, a tab or a carriage return first) gets an apostrophe in front, so it opens as text. A cell
 * that is only a number (`-5.00`, `+3`) is no formula and stays a number. Germomics' subscriber export had no guard;
 * Foxhound, Capsid and dustinedwards.info each had their own writer (the 2026-11-11 third audit pass).
 */

/** The Content-Type of a CSV answer. */
export const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;

/**
 * One field. null and undefined are empty; a number, bigint or boolean is written as it is; a Date as its ISO
 * time; anything else as its text, guarded and then quoted (doubling any quote) when it holds a comma, quote, CR
 * or LF.
 * @param {unknown} value
 */
export function csvCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean")
    return String(value);
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_START.test(text) && !PLAIN_NUMBER.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * One line of fields, without its line break.
 * @param {readonly unknown[]} cells
 */
export function csvRow(cells) {
  return cells.map(csvCell).join(",");
}

/**
 * A whole file: the header, then each row, every line ending CRLF (RFC 4180 section 2).
 * @param {readonly string[]} header
 * @param {Iterable<readonly unknown[]>} rows
 */
export function toCsv(header, rows) {
  const lines = [csvRow(header)];
  for (const row of rows) lines.push(csvRow(row));
  return `${lines.join("\r\n")}\r\n`;
}
