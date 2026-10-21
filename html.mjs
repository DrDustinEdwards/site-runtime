/**
 * HTML escaping, once, for every repo: local copies tended to miss the single quote.
 *
 * The five characters that can end a text run or an attribute value: & < > " and '. The result is safe as element
 * content and as a single- or double-quoted attribute value. It is not safe in an unquoted attribute, in a URL
 * attribute that may hold `javascript:`, or inside <script> or <style>: those need their own encoding.
 */

/** @type {Readonly<Record<string, string>>} */
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/**
 * `value` as HTML text: & < > " ' replaced by their entities, every other character unchanged. A value that is not a
 * string is first made one with String(), as a template literal would.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}
