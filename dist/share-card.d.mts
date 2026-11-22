/**
 * `value` as card text: `<` and `>` become ‹ and ›, so no text can open a tag, and everything else stays as is (an
 * entity would show literally; see the header).
 * @param {unknown} value
 * @returns {string}
 */
export function cardText(value: unknown): string;
/**
 * `value` cut at a word to at most `max` characters, ending in an ellipsis; one word longer than `max` is still cut, since
 * running off the card is worse.
 * @param {string | null | undefined} value
 * @param {number} max
 * @returns {string}
 */
export function clampTitle(value: string | null | undefined, max?: number): string;
/**
 * The font size a title is drawn at. Throws past the last rung, never falls back: that means the clamp and the ladder
 * disagree.
 * @param {string} title the title as drawn, already through clampTitle
 * @param {ReadonlyArray<{ maxChars: number, fontSize: number }>} [sizes]
 * @returns {number}
 */
export function titleFontSize(title: string, sizes?: ReadonlyArray<{
    maxChars: number;
    fontSize: number;
}>): number;
/**
 * The key a card is cached or stored under: `<prefix><slug>-<hash>.png`, the hash of what the card draws, so the key
 * changes when the picture would and never otherwise. FNV-1a, a cache-busting key and not a security boundary.
 * Pass what is drawn (the clamped title and description, the formatted date), and bump `version` on any change of the
 * template: an immutable cache ignores a restyled PNG under an unchanged key forever.
 * @param {{ slug: string, parts?: Array<string | null | undefined>, version?: number, prefix?: string }} card
 * @returns {string}
 */
export function cardKey({ slug, parts, version, prefix }: {
    slug: string;
    parts?: Array<string | null | undefined>;
    version?: number;
    prefix?: string;
}): string;
/**
 * A card's html for renderShareCard: a `mark` (raw html: a logo, an svg) and the `kicker` above, the title in the size it
 * fits, the description, and a band at the foot with `brand` and `footer`. Every text goes through cardText, and the
 * title and description are cut with clampTitle. Cards use inline styles with flex layout, so this is one.
 * @param {{
 *   brand: string,
 *   title: string,
 *   description?: string | null,
 *   kicker?: string | null,
 *   footer?: string | null,
 *   mark?: string,
 *   colors: { ground: string, ink: string, muted: string, band: string, bandInk: string, accent?: string },
 *   fontFamily?: string,
 *   titleSizes?: ReadonlyArray<{ maxChars: number, fontSize: number }>,
 * }} card `mark` is html the caller wrote, never from a visitor; `fontFamily` must be a font passed to the renderer
 * @returns {string}
 */
export function cardLayout({ brand, title, description, kicker, footer, mark, colors, fontFamily, titleSizes, }: {
    brand: string;
    title: string;
    description?: string | null;
    kicker?: string | null;
    footer?: string | null;
    mark?: string;
    colors: {
        ground: string;
        ink: string;
        muted: string;
        band: string;
        bandInk: string;
        accent?: string;
    };
    fontFamily?: string;
    titleSizes?: ReadonlyArray<{
        maxChars: number;
        fontSize: number;
    }>;
}): string;
/**
 * The card's PNG, or null when the render fails. `headers` are added to the PNG's (Content-Type image/png,
 * SHARE_CARD_HEADERS, and a week at the edge unless `headers` sets Cache-Control).
 * @param {(html: string, options: { width: number, height: number, fonts: unknown[] }) => Promise<Uint8Array | ArrayBuffer>} draw
 * @param {string} html
 * @param {{ fonts: unknown[], width?: number, height?: number, headers?: Record<string, string> }} options
 * @returns {Promise<Response | null>}
 */
export function renderShareCard(draw: (html: string, options: {
    width: number;
    height: number;
    fonts: unknown[];
}) => Promise<Uint8Array | ArrayBuffer>, html: string, { fonts, width, height, headers }: {
    fonts: unknown[];
    width?: number;
    height?: number;
    headers?: Record<string, string>;
}): Promise<Response | null>;
/**
 * One weight of a Google Font as bytes the renderer reads (TTF: an ancient browser's User-Agent makes Google Fonts serve one file with every glyph, in place of
 * WOFF2 split by script), or null when it cannot be fetched. With `cache`, the file is kept for a year under `cacheOrigin`.
 * @param {string} family
 * @param {number} weight
 * @param {{ cache?: Cache, cacheOrigin?: string, fetch?: typeof fetch }} [options]
 * @returns {Promise<ArrayBuffer | null>}
 */
export function googleFont(family: string, weight: number, { cache, cacheOrigin, fetch: get }?: {
    cache?: Cache;
    cacheOrigin?: string;
    fetch?: typeof fetch;
}): Promise<ArrayBuffer | null>;
/**
 * The card route's answer: the cached PNG under `cacheKey` when there is one, else the render of `html` with `fonts`
 * (each may be a function, called only on a miss, so a hit fetches no font and builds no HTML), kept in `cache` (in
 * `ctx.waitUntil` when given), or a 503 (`Retry-After: 300`, `no-store`) when the render fails. `cache` defaults to the
 * Workers zone cache; with no `cacheKey` nothing is cached. `headers` are added to the PNG's (after SHARE_CARD_HEADERS).
 * @param {(html: string, options: { width: number, height: number, fonts: unknown[] }) => Promise<Uint8Array | ArrayBuffer>} draw
 * @param {{
 *   html: string | (() => string | Promise<string>),
 *   fonts: unknown[] | (() => unknown[] | Promise<unknown[]>),
 *   cacheKey?: string | Request,
 *   cache?: Cache,
 *   ctx?: { waitUntil(promise: Promise<unknown>): void },
 *   width?: number,
 *   height?: number,
 *   headers?: Record<string, string>,
 * }} options
 * @returns {Promise<Response>}
 */
export function shareCardResponse(draw: (html: string, options: {
    width: number;
    height: number;
    fonts: unknown[];
}) => Promise<Uint8Array | ArrayBuffer>, { html, fonts, cacheKey, cache, ctx, width, height, headers }: {
    html: string | (() => string | Promise<string>);
    fonts: unknown[] | (() => unknown[] | Promise<unknown[]>);
    cacheKey?: string | Request;
    cache?: Cache;
    ctx?: {
        waitUntil(promise: Promise<unknown>): void;
    };
    width?: number;
    height?: number;
    headers?: Record<string, string>;
}): Promise<Response>;
/**
 * A renderer: the card's HTML drawn to PNG bytes (`drawShareCard` from ./share-card-draw).
 * @typedef {(
 * html: string,
 * options: { width: number; height: number; fonts: unknown[] },
 * ) => Promise<Uint8Array | ArrayBuffer>} ShareCardDraw
 */
/** The share-card size every family site uses, the size Open Graph previews draw at. */
export const SHARE_CARD_WIDTH: 1200;
export const SHARE_CARD_HEIGHT: 630;
/** What a card is served as: the page's og:image:type. */
export const SHARE_CARD_TYPE: "image/png";
/** The headers a card carries beside its type: other sites' previews load it. */
export const SHARE_CARD_HEADERS: Readonly<{
    "Cross-Origin-Resource-Policy": "cross-origin";
}>;
/** The longest title a card draws, in characters; `clampTitle` cuts to it. */
export const CARD_TITLE_MAX: 150;
/** The longest description a card draws: two lines at the layout's size. */
export const CARD_DESCRIPTION_MAX: 132;
/** The title's size by length, measured off rendered cards: the first rung the title fits is its font size. */
export const CARD_TITLE_SIZES: readonly (Readonly<{
    maxChars: 72;
    fontSize: 72;
}> | Readonly<{
    maxChars: 110;
    fontSize: 54;
}> | Readonly<{
    maxChars: 150;
    fontSize: 42;
}>)[];
/**
 * A renderer: the card's HTML drawn to PNG bytes (`drawShareCard` from ./share-card-draw).
 */
export type ShareCardDraw = (html: string, options: {
    width: number;
    height: number;
    fonts: unknown[];
}) => Promise<Uint8Array | ArrayBuffer>;
