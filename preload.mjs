/**
 * Preloads declared once: the same list gives the React Router `links` entries and the `Link` response header.
 * The header is what Cloudflare Early Hints reads: with the zone's Early Hints on, a 200, 301 or 302 HTML response
 * carrying `Link` with rel=preload or rel=preconnect is answered first with a 103 that names them, so the browser
 * starts the font or image while the Worker still renders
 * (https://developers.cloudflare.com/cache/advanced-configuration/early-hints/). The hints are cached per URI and may
 * not be sent for a response that is already cached.
 *
 * A font is always fetched in anonymous CORS mode, whatever its origin, so a font preload without `crossorigin` is a
 * different request and the file is fetched twice. Fonts get `crossorigin=anonymous` here unless the entry names
 * `use-credentials`.
 */

const AS = new Set(["font", "image", "style", "script", "fetch"]);
const CROSS_ORIGIN = new Set(["anonymous", "use-credentials"]);

/**
 * @typedef {{ rel?: "preload", href: string, as: "font" | "image" | "style" | "script" | "fetch", type?: string, crossOrigin?: "anonymous" | "use-credentials" }} Preload
 * @typedef {{ rel: "preconnect", href: string, crossOrigin?: "anonymous" | "use-credentials" }} Preconnect
 */

/**
 * The `links` entries and the `Link` header value for `entries`, in their order. Refuses an href that is not a path
 * or an https URL, or holds a character the header cannot carry unencoded (`<`, `>`, `"`, whitespace, non-ASCII), and a
 * `type` that is not a bare media type. `header` is empty for an empty list; a site sets nothing then.
 * @param {(Preload | Preconnect)[]} entries
 */
export function preloads(entries) {
  const links = entries.map((entry) => {
    const rel = entry.rel ?? "preload";
    if (rel !== "preload" && rel !== "preconnect") throw new Error(`preloads: rel "${rel}" is not preload or preconnect.`);
    if (!/^(\/(?!\/)|https:\/\/)[\x21-\x7e]*$/.test(entry.href) || /[<>"]/.test(entry.href)) {
      throw new Error(`preloads: href "${entry.href}" is not a path or an https URL with only ASCII characters a Link header can carry.`);
    }
    if (entry.crossOrigin !== undefined && !CROSS_ORIGIN.has(entry.crossOrigin)) {
      throw new Error(`preloads: crossOrigin "${entry.crossOrigin}" is not anonymous or use-credentials.`);
    }
    if (rel === "preconnect") return { rel, href: entry.href, ...(entry.crossOrigin ? { crossOrigin: entry.crossOrigin } : {}) };
    const { as, type } = /** @type {Preload} */ (entry);
    if (!AS.has(as)) throw new Error(`preloads: as "${as}" is not font, image, style, script or fetch.`);
    if (type !== undefined && !/^[\w.+-]+\/[\w.+-]+$/.test(type)) throw new Error(`preloads: type "${type}" is not a media type such as font/woff2.`);
    const crossOrigin = entry.crossOrigin ?? (as === "font" ? "anonymous" : undefined);
    return { rel, href: entry.href, as, ...(type ? { type } : {}), ...(crossOrigin ? { crossOrigin } : {}) };
  });
  const header = links
    .map((link) => {
      const params = [`<${link.href}>`, `rel=${link.rel}`];
      if ("as" in link) params.push(`as=${link.as}`);
      if ("type" in link) params.push(`type="${link.type}"`);
      if (link.crossOrigin) params.push(`crossorigin=${link.crossOrigin}`);
      return params.join("; ");
    })
    .join(", ");
  return { links, header };
}
