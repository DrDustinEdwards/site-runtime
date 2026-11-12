/**
 * HTML escaping, and reading markup back, once, for every repo: local copies tended to miss the single quote.
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

/** @type {Readonly<Record<string, string>>} */
const NAMED = { quot: '"', apos: "'", lt: "<", gt: ">", amp: "&", nbsp: "\u00a0" };

/**
 * `text` with its character references read: decimal and hex numeric ones (a code point outside 1 to 0x10FFFF stays as
 * written) and the six named ones markup carries (`&quot; &apos; &lt; &gt; &amp; &nbsp;`), in one pass, so `&amp;lt;`
 * becomes `&lt;`, not `<`. Any other name stays as written. For reading a page back, never for making output safe.
 * @param {string} text
 * @returns {string}
 */
export function unescapeHtml(text) {
  return text.replace(
    /&(?:#x([0-9a-f]+)|#(\d+)|(quot|apos|lt|gt|amp|nbsp));/gi,
    (whole, hex, dec, name) => {
      if (name) return NAMED[name.toLowerCase()] ?? whole;
      const code = Number.parseInt(hex ?? dec, hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    },
  );
}

/**
 * The attributes in a tag's text (`<a href="x" hidden>`, or just what follows the tag name), by lowercased name, with
 * their values read through `unescapeHtml`; an attribute with no value is "". The first of a repeated name wins, as in a
 * browser.
 * @param {string} text
 * @returns {Record<string, string | undefined>}
 */
export function htmlAttributes(text) {
  /** @type {Record<string, string>} */
  const attrs = {};
  for (const a of text.matchAll(/([^\s=/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const key = (a[1] ?? "").toLowerCase();
    if (!(key in attrs)) attrs[key] = unescapeHtml(a[2] ?? a[3] ?? a[4] ?? "");
  }
  return attrs;
}

/**
 * The addresses in a sitemap or sitemap index, in order: each `<loc>`, trimmed and read through `unescapeHtml`.
 * @param {string} xml
 * @returns {string[]}
 */
export function sitemapLocs(xml) {
  return [...xml.matchAll(/<loc>\s*([^<]*?)\s*<\/loc>/gi)].map((m) => unescapeHtml(m[1] ?? ""));
}
