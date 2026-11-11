/** "text/csv; charset=utf-8". */
export const CSV_CONTENT_TYPE: string;
/** One cell's value: a list is joined with "; "; null and undefined are empty; any other object is String()ed. */
export type CsvValue =
  | string
  | number
  | bigint
  | boolean
  | Date
  | null
  | undefined
  | readonly (string | number)[];
/** An apostrophe before text a spreadsheet would run as a formula (OWASP CSV Injection); plain numbers kept. */
export function guardFormula(text: string): string;
/** One RFC 4180 field, guarded. */
export function csvCell(value: CsvValue): string;
/** One record, without its line break. */
export function csvRow(cells: readonly CsvValue[]): string;
/** The header and each row, every record ending CRLF. */
export function toCsv(header: readonly string[], rows: Iterable<readonly CsvValue[]>): string;
/** Records as a file; the columns default to the first record's keys. */
export function recordsCsv(
  records: readonly Readonly<Record<string, CsvValue>>[],
  columns?: readonly string[],
): string;
/** The fields of a CSV text: BOM dropped, CRLF/LF/CR, quoted fields with doubled quotes and line breaks. */
export function parseCsv(text: string): string[][];
/** A download answer with the CSV type and `attachment; filename=...; filename*=UTF-8''...`. */
export function csvResponse(csv: string, filename: string, init?: ResponseInit): Response;
