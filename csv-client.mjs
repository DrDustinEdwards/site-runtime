/** The browser side of ./csv: hand the reader a CSV text as a file to save. */

import { CSV_CONTENT_TYPE } from "./csv.mjs";

/**
 * Saves `csv` as a file named `filename`: a Blob of the CSV type, an object URL, a hidden `<a download>` clicked, the
 * URL revoked after. Browser only.
 * @param {string} filename
 * @param {string} csv
 */
export function downloadCsv(filename, csv) {
  const url = URL.createObjectURL(new Blob([csv], { type: CSV_CONTENT_TYPE }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
