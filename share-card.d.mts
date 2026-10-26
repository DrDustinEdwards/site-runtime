/**
 * Share cards (share-card.mjs): a site's own card HTML drawn to a PNG by workers-og, with the escaping, whitespace and
 * error handling every card needs. workers-og stays the site's dependency, passed in as its ImageResponse class.
 */

/** The share-card size every family site uses. */
export const SHARE_CARD_WIDTH: 1200;
export const SHARE_CARD_HEIGHT: 630;

/** `value` as card text: `<` and `>` become ‹ and ›, `&` stays as is (workers-og shows entities literally). */
export function cardText(value: unknown): string;

/** The card's PNG (image/png, a week at the edge unless `headers` sets Cache-Control), or null when the render fails. */
export function renderShareCard(
  ImageResponse: new (html: string, options: { width: number; height: number; fonts: any[] }) => Response,
  html: string,
  options: { fonts: unknown[]; width?: number; height?: number; headers?: Record<string, string> },
): Promise<Response | null>;

/** One weight of a Google Font as WOFF bytes Satori reads, or null; kept a year in `cache` when given. */
export function googleFont(
  family: string,
  weight: number,
  options?: { cache?: Cache; cacheOrigin?: string; fetch?: typeof fetch },
): Promise<ArrayBuffer | null>;
