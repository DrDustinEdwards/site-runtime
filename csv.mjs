/**
 * CSV for every site, once: a table written as RFC 4180 text that a spreadsheet opens as data, read back the same
 * way, and answered as a download. The browser's save-as-file is ./csv-client.
 *
 * Writing follows RFC 4180 (https://www.rfc-editor.org/rfc/rfc4180): commas between fields, CRLF after every record
 * including the last, a field quoted when it holds a comma, a double quote, CR or LF, and a quote inside one written
 * twice. A text cell a spreadsheet would read as a formula gets an apostrophe in front, so it opens as text (OWASP,
 * https://owasp.org/www-community/attacks/CSV_Injection): `=`, `+`, `-`, `@`, tab, CR, LF, and the full-width
 * ＝ ＋ － ＠ that spreadsheets fold to ASCII. A number, boolean or date cannot hold a formula and is written as itself,
 * and so is a text that is only a number (`-5.00`), so an amount stays a number. Germomics' subscriber export had no
 * guard; Foxhound, Capsid, dustinedwards.info and Capsomer each had a writer (the 2026-11-11 third audit pass).
 */

/** The Content-Type of a CSV answer. */
export const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";

const FORMULA = /^[=+\-@\t\r\n\uFF1D\uFF0B\uFF0D\uFF20]/;
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;

/**
 * `text` with an apostrophe in front when a spreadsheet would read it as a formula; a plain number is left alone.
 * @param {string} text
 */
export function guardFormula(text) {
  return FORMULA.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text;
}

/** @param {unknown} value */
function textOf(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean")
    return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return guardFormula(value.join("; "));
  return guardFormula(String(value));
}

/**
 * One field: null and undefined empty, a list its items joined with "; ", guarded, then quoted when it needs it.
 * @param {unknown} value
 */
export function csvCell(value) {
  const text = textOf(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * One record, without its line break.
 * @param {readonly unknown[]} cells
 */
export function csvRow(cells) {
  return cells.map(csvCell).join(",");
}

/**
 * The whole file: the header, then each row, every record ending CRLF.
 * @param {readonly string[]} header
 * @param {Iterable<readonly unknown[]>} rows
 */
export function toCsv(header, rows) {
  let out = `${csvRow(header)}\r\n`;
  for (const row of rows) out += `${csvRow(row)}\r\n`;
  return out;
}

/**
 * Records as a file: the columns are `columns`, or the first record's keys in order; a missing key is an empty cell.
 * @param {readonly Readonly<Record<string, unknown>>[]} records
 * @param {readonly string[]} [columns]
 */
export function recordsCsv(records, columns = Object.keys(records[0] ?? {})) {
  return toCsv(
    columns,
    records.map((r) => columns.map((c) => r[c])),
  );
}

/**
 * The fields of a CSV text, record by record (RFC 4180, and forgiving): a byte order mark is dropped, CRLF, LF and a
 * lone CR each end a record, a quoted field may hold commas, quotes and line breaks, and a blank last line is not a
 * record. Fields are not trimmed.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const src = text.replace(/^\uFEFF/, "");
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  let field = "";
  let quoted = false;
  let started = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    started = true;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      started = false;
    } else field += c;
  }
  if (started) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * `attachment` with the name: ASCII in `filename`, the exact name in `filename*` (RFC 6266, RFC 5987).
 * @param {string} filename
 */
function disposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const exact = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${exact}`;
}

/**
 * A download answer: the CSV type and an attachment with this file name; `init` adds status and headers.
 * @param {string} csv
 * @param {string} filename
 * @param {ResponseInit} [init]
 */
export function csvResponse(csv, filename, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", CSV_CONTENT_TYPE);
  headers.set("content-disposition", disposition(filename));
  return new Response(csv, { ...init, headers });
}
