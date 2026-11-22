/**
 * Saves `csv` as a file named `filename`: a Blob of the CSV type, an object URL, a hidden `<a download>` clicked, the
 * URL revoked after. Browser only.
 * @param {string} filename
 * @param {string} csv
 */
export function downloadCsv(filename: string, csv: string): void;
