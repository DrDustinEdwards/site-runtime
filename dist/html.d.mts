/**
 * `value` as HTML text: & < > " ' replaced by their entities, every other character unchanged. A value that is not a
 * string is first made one with String(), as a template literal would.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value: unknown): string;
/**
 * `text` with its character references read: decimal and hex numeric ones (a code point outside 1 to 0x10FFFF, or a
 * lone surrogate, stays as written) and the named ones in `namedReferences` (the markup five, Latin-1, typographic quotes, dashes,
 * spaces and arrows), in one pass, so `&amp;lt;` becomes `&lt;`, not `<`. Any other name stays as written. For reading a
 * page or an email back, never for making output safe.
 * @param {string} text
 * @returns {string}
 */
export function unescapeHtml(text: string): string;
/**
 * The attributes in a tag's text (`<a href="x" hidden>`, or just what follows the tag name), by lowercased name, with
 * their values read through `unescapeHtml`; an attribute with no value is "". The first of a repeated name wins, as in a
 * browser.
 * @param {string} text
 * @returns {Record<string, string | undefined>}
 */
export function htmlAttributes(text: string): Record<string, string | undefined>;
/**
 * The addresses in a sitemap or sitemap index, in order: each `<loc>`, trimmed and read through `unescapeHtml`.
 * @param {string} xml
 * @returns {string[]}
 */
export function sitemapLocs(xml: string): string[];
/**
 * JSON that is safe inside a <script> element: no "<", ">" or "&", and U+2028 and U+2029 escaped (React Router's own
 * escaping). Use it for a `<script type="application/json">` or a JSON-LD block.
 * @param {unknown} value
 * @returns {string}
 */
export function scriptJson(value: unknown): string;
