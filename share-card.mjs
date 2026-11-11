/**
 * Share cards: the PNG a link preview shows (og:image), drawn from a site's own card HTML by workers-og (Satori and
 * resvg). Each site keeps its own design; this module is the part every card needs the same way.
 *
 * workers-og is the site's dependency, passed in as its ImageResponse class, so this package stays free of WASM.
 *
 * What the renderer needs, learned on Foxhound and Foxing:
 * - workers-og does not decode entities in text: "&amp;" shows on the card as five characters, and "&lt;" as four. So
 *   card text keeps `&` as is, and `<` and `>`, which would start a tag, become the look-alike marks ‹ and ›. Card text
 *   sits only in element content, never in an attribute.
 * - Whitespace between two tags becomes a text child of the flex box, which takes part in justify-content and needs
 *   display:flex on its parent. `renderShareCard` removes it.
 * - A render error happens while the PNG streams, after ImageResponse returns, and used to end as an empty image.
 *   `renderShareCard` reads the whole PNG first, so a failure is a null the route can answer with a fallback.
 * - A card's root sized `width:100%;height:100%` has nothing to be a percentage of and shrinks to its content (Foxing's
 *   cards did). `renderShareCard` draws the card inside a box of the card's size, so a percentage resolves.
 * - Fonts are TTF, OTF or WOFF, one static weight per file: Satori cannot read WOFF2 or a variable font.
 *
 * `cardLayout` is the card most sites want, so a site passes its colors and mark and not a layout of its own: the title
 * set in the largest of three sizes it fits (`titleFontSize`), both texts cut at a word (`clampTitle`) because Satori's
 * line clamp does nothing, and `cardKey` for a cache key that changes when the picture would. From dustinedwards.info's
 * build-og.mjs and og-card-text.mjs, measured off rendered 1200x630 cards. A bespoke card passes its own html instead.
 *
 * `shareCardResponse` is the whole route around the render, as Foxhound's /og and Foxing's card routes had it: the edge
 * cache first (under the site's key, which carries whatever changes the card, such as the item's updated time), then
 * the render (every card, from either function, carries Cross-Origin-Resource-Policy: cross-origin: it is an image
 * other sites show, and the default is same-origin), then the PNG kept in the cache, and a 503 with Retry-After when the render fails, never an
 * empty image.
 */

import { fnv1a32 } from "./encoding.mjs";
import { logEvent } from "./log.mjs";

/** The share-card size every family site uses, the size Open Graph previews draw at. */
export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 630;
/** What a card is served as: the page's og:image:type. */
export const SHARE_CARD_TYPE = "image/png";

/** The headers a card carries beside its type: other sites' previews load it. */
export const SHARE_CARD_HEADERS = Object.freeze({ "Cross-Origin-Resource-Policy": "cross-origin" });

/**
 * `value` as card text: `<` and `>` become ‹ and ›, so no text can open a tag, and everything else stays as is (an
 * entity would show literally; see the header).
 * @param {unknown} value
 * @returns {string}
 */
export function cardText(value) {
  return String(value).replace(/</g, "\u2039").replace(/>/g, "\u203a");
}

/** The longest title a card draws, in characters; `clampTitle` cuts to it. */
export const CARD_TITLE_MAX = 150;
/** The longest description a card draws: two lines at the layout's size. */
export const CARD_DESCRIPTION_MAX = 132;
/** The title's size by length, measured off rendered cards: the first rung the title fits is its font size. */
export const CARD_TITLE_SIZES = Object.freeze([
  Object.freeze({ maxChars: 72, fontSize: 72 }),
  Object.freeze({ maxChars: 110, fontSize: 54 }),
  Object.freeze({ maxChars: CARD_TITLE_MAX, fontSize: 42 }),
]);

// Dashes as escapes: a hook bans those characters from the repo's bytes.
const DANGLING_PUNCTUATION = new RegExp("[,;:.\\u2014\\u2013-]+$");

/**
 * `value` cut at a word to at most `max` characters, ending in an ellipsis; one word longer than `max` is still cut, since
 * running off the card is worse.
 * @param {string | null | undefined} value
 * @param {number} max
 * @returns {string}
 */
export function clampTitle(value, max = CARD_TITLE_MAX) {
  const text = (value ?? "").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const kept = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return `${kept.replace(DANGLING_PUNCTUATION, "")}\u2026`;
}

/**
 * The font size a title is drawn at. Throws past the last rung, never falls back: that means the clamp and the ladder
 * disagree.
 * @param {string} title the title as drawn, already through clampTitle
 * @param {ReadonlyArray<{ maxChars: number, fontSize: number }>} [sizes]
 * @returns {number}
 */
export function titleFontSize(title, sizes = CARD_TITLE_SIZES) {
  const length = (title ?? "").length;
  for (const rung of sizes) if (length <= rung.maxChars) return rung.fontSize;
  throw new Error(
    `share-card: a ${length}-character title is past the last rung of the ladder (${sizes.at(-1)?.maxChars}); ` +
      "titles go through clampTitle first.",
  );
}

/**
 * The key a card is cached or stored under: `<prefix><slug>-<hash>.png`, the hash of what the card draws, so the key
 * changes when the picture would and never otherwise. FNV-1a, a cache-busting key and not a security boundary.
 * Pass what is drawn (the clamped title and description, the formatted date), and bump `version` on any change of the
 * template: an immutable cache ignores a restyled PNG under an unchanged key forever.
 * @param {{ slug: string, parts?: Array<string | null | undefined>, version?: number, prefix?: string }} card
 * @returns {string}
 */
export function cardKey({ slug, parts = [], version = 1, prefix = "og/" }) {
  return `${prefix}${slug}-${fnv1a32(`${version}\n${slug}\n${parts.map((p) => p ?? "").join("\n")}`)}.png`;
}

/**
 * A card's html for renderShareCard: a `mark` (raw html: a logo, an svg) and the `kicker` above, the title in the size it
 * fits, the description, and a band at the foot with `brand` and `footer`. Every text goes through cardText, and the
 * title and description are cut with clampTitle. Satori reads only inline styles with flex layout, so this is one.
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
export function cardLayout({
  brand,
  title,
  description,
  kicker,
  footer,
  mark = "",
  colors,
  fontFamily = "sans-serif",
  titleSizes = CARD_TITLE_SIZES,
}) {
  const drawnTitle = clampTitle(title);
  const drawnDescription = clampTitle(description, CARD_DESCRIPTION_MAX);
  const accent = colors.accent ?? colors.muted;
  const pad = "72px";
  const lines = [
    `<div style="display:flex;flex-direction:column;width:100%;height:100%;background:${colors.ground};font-family:${fontFamily};">`,
    `<div style="display:flex;flex:1;flex-direction:column;justify-content:center;padding:40px ${pad} 0;">`,
    mark || kicker
      ? `<div style="display:flex;align-items:center;margin-bottom:28px;color:${accent};font-size:24px;font-weight:600;letter-spacing:0.12em;">${mark}${kicker ? `<span style="display:flex;${mark ? "margin-left:20px;" : ""}">${cardText(kicker).toUpperCase()}</span>` : ""}</div>`
      : "",
    // Satori honors wordBreak but ignores overflowWrap.
    `<div style="display:flex;font-size:${titleFontSize(drawnTitle, titleSizes)}px;font-weight:600;color:${colors.ink};line-height:1.12;word-break:break-word;">${cardText(drawnTitle)}</div>`,
    drawnDescription
      ? `<div style="display:flex;margin-top:18px;font-size:26px;color:${colors.muted};line-height:1.4;word-break:break-word;">${cardText(drawnDescription)}</div>`
      : "",
    `</div>`,
    `<div style="display:flex;justify-content:space-between;margin-top:28px;padding:16px ${pad};background:${colors.band};border-top:8px solid ${accent};color:${colors.bandInk};font-size:22px;font-weight:600;letter-spacing:0.16em;">`,
    `<div style="display:flex;">${cardText(brand).toUpperCase()}</div>`,
    `<div style="display:flex;font-weight:400;letter-spacing:0.04em;">${footer ? cardText(footer) : ""}</div>`,
    `</div>`,
    `</div>`,
  ];
  return lines.join("");
}

/**
 * The card's PNG, or null when the render fails. `headers` are added to the PNG's (Content-Type image/png,
 * SHARE_CARD_HEADERS, and a week at the edge unless `headers` sets Cache-Control).
 * @param {new (html: string, options: { width: number, height: number, fonts: unknown[] }) => Response} ImageResponse
 * @param {string} html
 * @param {{ fonts: unknown[], width?: number, height?: number, headers?: Record<string, string> }} options
 * @returns {Promise<Response | null>}
 */
export async function renderShareCard(
  ImageResponse,
  html,
  { fonts, width = SHARE_CARD_WIDTH, height = SHARE_CARD_HEIGHT, headers = {} },
) {
  try {
    const card = html.replace(/>\s+</g, "><").trim();
    const sized = `<div style="display:flex;width:${width}px;height:${height}px;">${card}</div>`;
    const image = new ImageResponse(sized, { width, height, fonts });
    const png = await new Response(image.body).arrayBuffer();
    if (png.byteLength === 0) throw new Error("empty PNG");
    return new Response(png, {
      headers: {
        "Content-Type": SHARE_CARD_TYPE,
        "Cache-Control": "public, max-age=0, s-maxage=604800, immutable",
        ...SHARE_CARD_HEADERS,
        ...headers,
      },
    });
  } catch (err) {
    logEvent("share_card_failed", { error: err }, { level: "error" });
    return null;
  }
}

/**
 * One weight of a Google Font as bytes Satori reads (WOFF: an old browser's User-Agent makes Google Fonts serve it in
 * place of WOFF2), or null when it cannot be fetched. With `cache`, the file is kept for a year under `cacheOrigin`.
 * @param {string} family
 * @param {number} weight
 * @param {{ cache?: Cache, cacheOrigin?: string, fetch?: typeof fetch }} [options]
 * @returns {Promise<ArrayBuffer | null>}
 */
export async function googleFont(
  family,
  weight,
  { cache, cacheOrigin = "https://share-card.invalid", fetch: get = fetch } = {},
) {
  const key = `${cacheOrigin}/${encodeURIComponent(family)}-${weight}.font`;
  const hit = await cache?.match(key);
  if (hit) return hit.arrayBuffer();
  try {
    const css = await get(
      `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}`,
      {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1)" },
      },
    ).then((r) => r.text());
    const url = css.match(
      /src:\s*url\((.+?)\)\s*format\(['"]?(?:woff|truetype|opentype)['"]?\)/,
    )?.[1];
    if (!url) return null;
    const res = await get(url);
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    await cache?.put(
      key,
      new Response(bytes, { headers: { "Cache-Control": "public, max-age=31536000" } }),
    );
    return bytes;
  } catch {
    return null;
  }
}

/**
 * The card route's answer: the cached PNG under `cacheKey` when there is one, else the render of `html` with `fonts`
 * (each may be a function, called only on a miss, so a hit fetches no font and builds no HTML), kept in `cache` (in
 * `ctx.waitUntil` when given), or a 503 (`Retry-After: 300`, `no-store`) when the render fails. `cache` defaults to the
 * Workers zone cache; with no `cacheKey` nothing is cached. `headers` are added to the PNG's (after SHARE_CARD_HEADERS).
 * @param {new (html: string, options: { width: number, height: number, fonts: unknown[] }) => Response} ImageResponse
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
export async function shareCardResponse(
  ImageResponse,
  { html, fonts, cacheKey, cache = zoneCache(), ctx, width, height, headers = {} },
) {
  const store = cacheKey !== undefined ? cache : undefined;
  const hit = await store?.match(cacheKey ?? "").catch(() => undefined);
  if (hit) return hit;
  let png = null;
  try {
    const [cardHtml, cardFonts] = await Promise.all([
      typeof html === "function" ? html() : html,
      typeof fonts === "function" ? fonts() : fonts,
    ]);
    png = await renderShareCard(ImageResponse, cardHtml, {
      fonts: cardFonts,
      width,
      height,
      headers,
    });
  } catch (error) {
    logEvent("share_card_failed", { error }, { level: "error" });
  }
  if (!png) {
    return new Response("Card unavailable", {
      status: 503,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Retry-After": "300",
        "Cache-Control": "no-store",
      },
    });
  }
  if (store && cacheKey !== undefined) {
    const put = store
      .put(cacheKey, png.clone())
      .catch((error) => logEvent("share_card_cache_failed", { error }, { level: "warn" }));
    if (ctx) ctx.waitUntil(put);
    else await put;
  }
  return png;
}

/** The Workers zone cache, when the runtime has one. @returns {Cache | undefined} */
function zoneCache() {
  return /** @type {{ caches?: { default?: Cache } }} */ (/** @type {unknown} */ (globalThis))
    .caches?.default;
}
