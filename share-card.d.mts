/**
 * Share cards (share-card.mjs): a site's own card HTML drawn to a PNG by workers-og, with the escaping, whitespace and
 * error handling every card needs. workers-og stays the site's dependency, passed in as its ImageResponse class.
 */

/** The share-card size every family site uses. */
export const SHARE_CARD_WIDTH: 1200;
export const SHARE_CARD_HEIGHT: 630;
/** What a card is served as, for og:image:type. */
export const SHARE_CARD_TYPE: "image/png";

/** `value` as card text: `<` and `>` become ‹ and ›, `&` stays as is (workers-og shows entities literally). */
export function cardText(value: unknown): string;

/** The longest title a card draws: 150 characters. */
export const CARD_TITLE_MAX: 150;
/** The longest description a card draws: 132 characters, two lines. */
export const CARD_DESCRIPTION_MAX: 132;
/** The title's size by length (72 up to 72 characters, 54 up to 110, 42 up to 150). */
export const CARD_TITLE_SIZES: ReadonlyArray<Readonly<{ maxChars: number; fontSize: number }>>;
/** `value` cut at a word to at most `max` characters (default CARD_TITLE_MAX), ending in an ellipsis. */
export function clampTitle(value: string | null | undefined, max?: number): string;
/** The font size a (clamped) title is drawn at; throws past the last rung. */
export function titleFontSize(
  title: string,
  sizes?: ReadonlyArray<{ maxChars: number; fontSize: number }>,
): number;
/** `<prefix><slug>-<hash>.png`: the hash of what the card draws, so the key changes when the picture would. */
export function cardKey(card: {
  slug: string;
  parts?: Array<string | null | undefined>;
  version?: number;
  prefix?: string;
}): string;
/** A card's html: mark and kicker, the title in the size it fits, the description, a band with brand and footer. */
export function cardLayout(card: {
  brand: string;
  title: string;
  description?: string | null;
  kicker?: string | null;
  footer?: string | null;
  /** Html the caller wrote (a logo, an svg), never a visitor's text. */
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
  titleSizes?: ReadonlyArray<{ maxChars: number; fontSize: number }>;
}): string;

/** The card's PNG (image/png, CORP cross-origin, a week at the edge unless `headers` sets Cache-Control), or null when the render fails. */
export function renderShareCard(
  ImageResponse: new (
    html: string,
    options: { width: number; height: number; fonts: never[] },
  ) => Response,
  html: string,
  options: { fonts: unknown[]; width?: number; height?: number; headers?: Record<string, string> },
): Promise<Response | null>;

/** One weight of a Google Font as WOFF bytes Satori reads, or null; kept a year in `cache` when given. */
export function googleFont(
  family: string,
  weight: number,
  options?: { cache?: Cache; cacheOrigin?: string; fetch?: typeof fetch },
): Promise<ArrayBuffer | null>;

/** Cross-Origin-Resource-Policy: cross-origin, which every card carries. */
export const SHARE_CARD_HEADERS: Readonly<{ "Cross-Origin-Resource-Policy": "cross-origin" }>;

/**
 * The card route's answer: the cached PNG under `cacheKey`, else the render (html and fonts may be functions, called on a
 * miss only), kept in `cache` (default the zone cache; in `ctx.waitUntil` when given), else a 503 with Retry-After: 300.
 */
export function shareCardResponse(
  ImageResponse: new (
    html: string,
    options: { width: number; height: number; fonts: never[] },
  ) => Response,
  options: {
    html: string | (() => string | Promise<string>);
    fonts: unknown[] | (() => unknown[] | Promise<unknown[]>);
    cacheKey?: string | Request;
    cache?: Cache;
    ctx?: { waitUntil(promise: Promise<unknown>): void };
    width?: number;
    height?: number;
    headers?: Record<string, string>;
  },
): Promise<Response>;
