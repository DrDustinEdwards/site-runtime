/** HTML escaping, once (html.mjs). */
/** `value` as HTML text: & < > " ' replaced by their entities. A non-string is passed through String() first. */
export function escapeHtml(value: unknown): string;
/** `text` with its decimal, hex and named (the markup five, Latin-1, typographic quotes, dashes, spaces, arrows) character references read, in one pass; others stay. */
export function unescapeHtml(text: string): string;
/** A tag's attributes by lowercased name, values read through `unescapeHtml`; no value is ""; the first of a repeated name wins. */
export function htmlAttributes(text: string): Record<string, string | undefined>;
/** The `<loc>` addresses of a sitemap or sitemap index, in order, trimmed and with character references read. */
export function sitemapLocs(xml: string): string[];
