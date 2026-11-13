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

// The names after U+00A0 in order: U+00A0 to U+00FF, Latin-1's letters and signs.
const LATIN1 =
  "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro " +
  "para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil " +
  "Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave " +
  "Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml " +
  "igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute " +
  "thorn yuml";

/**
 * The named references mail and CMS markup carries: the markup five, Latin-1, typographic quotes, dashes and spaces,
 * arrows and the Latin-extended letters. Names are case-sensitive, as in HTML (`&Eacute;` is not `&eacute;`).
 * @returns {Readonly<Record<string, string>>}
 */
function namedReferences() {
  return Object.freeze({
    ...Object.fromEntries(
      LATIN1.split(" ").map((name, i) => [name, String.fromCodePoint(0xa0 + i)]),
    ),
    quot: '"',
    QUOT: '"',
    apos: "'",
    lt: "<",
    LT: "<",
    gt: ">",
    GT: ">",
    amp: "&",
    AMP: "&",
    COPY: "\u00a9",
    REG: "\u00ae",
    trade: "\u2122",
    lsquo: "\u2018",
    rsquo: "\u2019",
    sbquo: "\u201a",
    ldquo: "\u201c",
    rdquo: "\u201d",
    bdquo: "\u201e",
    lsaquo: "\u2039",
    rsaquo: "\u203a",
    ndash: "\u2013",
    mdash: "\u2014",
    minus: "\u2212",
    hellip: "\u2026",
    bull: "\u2022",
    dagger: "\u2020",
    Dagger: "\u2021",
    permil: "\u2030",
    prime: "\u2032",
    Prime: "\u2033",
    euro: "\u20ac",
    ensp: "\u2002",
    emsp: "\u2003",
    thinsp: "\u2009",
    zwnj: "\u200c",
    zwj: "\u200d",
    larr: "\u2190",
    rarr: "\u2192",
    uarr: "\u2191",
    darr: "\u2193",
    check: "\u2713",
    OElig: "\u0152",
    oelig: "\u0153",
    Scaron: "\u0160",
    scaron: "\u0161",
    Yuml: "\u0178",
    fnof: "\u0192",
    circ: "\u02c6",
    tilde: "\u02dc",
  });
}

/** @type {Readonly<Record<string, string>> | undefined} */
let named;

/**
 * `text` with its character references read: decimal and hex numeric ones (a code point outside 1 to 0x10FFFF, or a
 * lone surrogate, stays as written) and the named ones in `namedReferences` (the markup five, Latin-1, typographic quotes, dashes,
 * spaces and arrows), in one pass, so `&amp;lt;` becomes `&lt;`, not `<`. Any other name stays as written. For reading a
 * page or an email back, never for making output safe.
 * @param {string} text
 * @returns {string}
 */
export function unescapeHtml(text) {
  return text.replace(
    /&(?:#[xX]([0-9a-fA-F]+)|#(\d+)|([a-zA-Z][a-zA-Z0-9]*));/g,
    (whole, hex, dec, name) => {
      if (name) {
        named ??= namedReferences();
        return Object.hasOwn(named, name) ? (named[name] ?? whole) : whole;
      }
      const code = Number.parseInt(hex ?? dec, hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : whole;
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
