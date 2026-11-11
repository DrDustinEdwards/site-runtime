/** "text/csv; charset=utf-8". */
export const CSV_CONTENT_TYPE: string;
/** One RFC 4180 field; text a spreadsheet would run as a formula gets an apostrophe first (OWASP CSV Injection). */
export function csvCell(value: unknown): string;
/** One line of fields, without its line break. */
export function csvRow(cells: readonly unknown[]): string;
/** The header and each row, every line ending CRLF. */
export function toCsv(header: readonly string[], rows: Iterable<readonly unknown[]>): string;
