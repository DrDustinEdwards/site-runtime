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
 */

/** The share-card size every family site uses, the size Open Graph previews draw at. */
export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 630;

/**
 * `value` as card text: `<` and `>` become ‹ and ›, so no text can open a tag, and everything else stays as is (an
 * entity would show literally; see the header).
 * @param {unknown} value
 * @returns {string}
 */
export function cardText(value) {
  return String(value).replace(/</g, "\u2039").replace(/>/g, "\u203a");
}

/**
 * The card's PNG, or null when the render fails. `headers` are added to the PNG's (Content-Type image/png, and a
 * week at the edge unless `headers` sets Cache-Control).
 * @param {new (html: string, options: { width: number, height: number, fonts: unknown[] }) => Response} ImageResponse
 * @param {string} html
 * @param {{ fonts: unknown[], width?: number, height?: number, headers?: Record<string, string> }} options
 * @returns {Promise<Response | null>}
 */
export async function renderShareCard(ImageResponse, html, { fonts, width = SHARE_CARD_WIDTH, height = SHARE_CARD_HEIGHT, headers = {} }) {
  try {
    const card = html.replace(/>\s+</g, "><").trim();
    const sized = `<div style="display:flex;width:${width}px;height:${height}px;">${card}</div>`;
    const image = new ImageResponse(sized, { width, height, fonts });
    const png = await new Response(image.body).arrayBuffer();
    if (png.byteLength === 0) throw new Error("empty PNG");
    return new Response(png, {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=0, s-maxage=604800, immutable", ...headers },
    });
  } catch (err) {
    console.error(JSON.stringify({ event: "share_card_failed", error: String(err) }));
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
export async function googleFont(family, weight, { cache, cacheOrigin = "https://share-card.invalid", fetch: get = fetch } = {}) {
  const key = `${cacheOrigin}/${encodeURIComponent(family)}-${weight}.font`;
  const hit = await cache?.match(key);
  if (hit) return hit.arrayBuffer();
  try {
    const css = await get(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1)" },
    }).then((r) => r.text());
    const url = css.match(/src:\s*url\((.+?)\)\s*format\(['"]?(?:woff|truetype|opentype)['"]?\)/)?.[1];
    if (!url) return null;
    const res = await get(url);
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    await cache?.put(key, new Response(bytes, { headers: { "Cache-Control": "public, max-age=31536000" } }));
    return bytes;
  } catch {
    return null;
  }
}
