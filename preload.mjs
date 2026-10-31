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
 *
 * A responsive image preloads its set, not one file: `imageSrcSet` and `imageSizes` (the `<img>`'s srcset and sizes,
 * `imagePreload` in ./image builds them) let the browser fetch the size it will show, in the tag and in the 103 alike.
 */

const AS = new Set(["font", "image", "style", "script", "fetch"]);
const CROSS_ORIGIN = new Set(["anonymous", "use-credentials"]);

/**
 * @typedef {{ rel?: "preload", href: string, as: "font" | "image" | "style" | "script" | "fetch", type?: string, crossOrigin?: "anonymous" | "use-credentials", imageSrcSet?: string, imageSizes?: string, fetchPriority?: "high" | "low" | "auto" }} Preload
 * @typedef {{ rel: "preconnect", href: string, crossOrigin?: "anonymous" | "use-credentials" }} Preconnect
 */

/**
 * The `links` entries and the `Link` header value for `entries`, in their order. Refuses an href that is not a path
 * or an https URL, or holds a character the header cannot carry unencoded (`<`, `>`, `"`, whitespace, non-ASCII), and a
 * `type` that is not a bare media type, and image set fields on anything but an image or holding a character a quoted
 * header value cannot carry. `header` is empty for an empty list; a site sets nothing then.
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
    const { as, type, imageSrcSet, imageSizes, fetchPriority } = /** @type {Preload} */ (entry);
    if (!AS.has(as)) throw new Error(`preloads: as "${as}" is not font, image, style, script or fetch.`);
    if (type !== undefined && !/^[\w.+-]+\/[\w.+-]+$/.test(type)) throw new Error(`preloads: type "${type}" is not a media type such as font/woff2.`);
    for (const [name, value] of Object.entries({ imageSrcSet, imageSizes })) {
      if (value === undefined) continue;
      if (as !== "image") throw new Error(`preloads: ${name} is for an image, not ${as}.`);
      if (!/^[\x20-\x7e]+$/.test(value) || /[<>"\\]/.test(value)) throw new Error(`preloads: ${name} "${value}" holds a character a Link header cannot carry.`);
    }
    if (fetchPriority !== undefined && !["high", "low", "auto"].includes(fetchPriority)) throw new Error(`preloads: fetchPriority "${fetchPriority}" is not high, low or auto.`);
    const crossOrigin = entry.crossOrigin ?? (as === "font" ? "anonymous" : undefined);
    return {
      rel,
      href: entry.href,
      as,
      ...(type ? { type } : {}),
      ...(crossOrigin ? { crossOrigin } : {}),
      ...(imageSrcSet ? { imageSrcSet } : {}),
      ...(imageSizes ? { imageSizes } : {}),
      ...(fetchPriority ? { fetchPriority } : {}),
    };
  });
  const header = links
    .map((link) => {
      const params = [`<${link.href}>`, `rel=${link.rel}`];
      if ("as" in link) params.push(`as=${link.as}`);
      if ("type" in link) params.push(`type="${link.type}"`);
      if (link.crossOrigin) params.push(`crossorigin=${link.crossOrigin}`);
      if ("imageSrcSet" in link) params.push(`imagesrcset="${link.imageSrcSet}"`);
      if ("imageSizes" in link) params.push(`imagesizes="${link.imageSizes}"`);
      if ("fetchPriority" in link) params.push(`fetchpriority=${link.fetchPriority}`);
      return params.join("; ");
    })
    .join(", ");
  return { links, header };
}

/**
 * The root route's stylesheets in a React Router server build (`build.assets.routes.root.css`), as preload entries:
 * the CSS every page blocks on, named by its hashed URL.
 * @param {{ assets: { routes: Record<string, { css?: string[] } | undefined> } }} build
 * @returns {Preload[]}
 */
export function rootStylesheets(build) {
  return (build.assets.routes.root?.css ?? []).map((href) => ({ href, as: "style" }));
}

/**
 * `response` with each non-empty `Link` header value appended, when it is HTML. Appended, so a route's own Link (a
 * markdown alternate, a webmention endpoint) stays; rebuilt when its headers are immutable.
 * @param {Response} response
 * @param {...string} values `preloads(...).header` values
 */
export function withPreloadHeader(response, ...values) {
  const links = values.filter(Boolean);
  if (!links.length || !(response.headers.get("Content-Type") ?? "").startsWith("text/html")) return response;
  const append = (/** @type {Headers} */ headers) => {
    for (const link of links) headers.append("Link", link);
  };
  try {
    append(response.headers);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    append(headers);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
}
