/** One page's findings: its images (A2 to A7, B1, B2, D2, A12, C8, C9) and what the other parts of the audit add. */

import { RASTER_PATH, RASTER_TYPES } from "../image.mjs";
import { readImage } from "./image-file.mjs";
import { auditCsp, auditMedia, auditSizeUrls, linkHeader } from "./images-checks.mjs";
import { PARALLEL, READ_LIMIT, collect, corpOf, inParallel, shorten } from "./images-fetch.mjs";
import {
  candidatesOf,
  childElements,
  descendants,
  parseTree,
  picked,
  placeImages,
  slotWidth,
  within,
} from "./images-layout.mjs";
import { auditShareCard } from "./images-share.mjs";

/** @import { El, Fetched, Finding, ImageFile, Load } from "./images-fetch.mjs" */

/** The two screens the checklist's crawl uses. */
const VIEWPORTS = [
  { width: 390, height: 844, dpr: 3 },
  { width: 1440, height: 900, dpr: 1 },
];
/** A shown width at or under this is an icon-size slot: one file serves it at 2x. */
const SMALL_SLOT = 48;
const ABOVE = 0.8;
const BELOW = 1.1;
/** The smallest visible area (CSS px) an image needs to be a page's largest paint rather than an icon. */
const LCP_AREA = 150 * 150;

/**
 * @param {{ url: string, origin: string, html: string, headers: Headers, load: Load, probe: (url: string, headers: Record<string, string>) => Promise<Fetched>, onSite: (url: string) => boolean, sitemapImages: boolean | undefined }} input
 */
export async function auditPage({
  url,
  origin,
  html,
  headers,
  load,
  probe,
  onSite,
  sitemapImages,
}) {
  const { findings, add } = collect();
  const body = html.replace(
    /<!--[\s\S]*?-->|<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/gi,
    "",
  );
  const absolute = (/** @type {string | undefined} */ href) => {
    if (!href || href.startsWith("data:")) return null;
    try {
      return new URL(href, url).href;
    } catch {
      return null;
    }
  };
  const tree = parseTree(body);
  const all = descendants(tree);
  const imgs = all.filter((e) => e.tag === "img");
  const main = all.find((e) => e.tag === "main");
  /** The URLs an <img> may load: its src and every srcset candidate, its <picture>'s too. @param {El} img */
  const urlsOf = (img) => {
    const sources =
      img.parent?.tag === "picture"
        ? childElements(img.parent).filter((c) => c.tag === "source")
        : [];
    return [
      img.attrs.src,
      ...[img, ...sources].flatMap((e) => candidatesOf(e.attrs.srcset).map((c) => c.url)),
    ]
      .map(absolute)
      .filter((u) => u !== null);
  };

  // D2, A12 and C11 on every original the page shows or links; their sizes feed A2, A7 and the layout.
  const isOriginal = (/** @type {string} */ href) => {
    if (!href || !onSite(href)) return false;
    const parsed = new URL(href);
    return (
      !parsed.searchParams.has("w") &&
      !parsed.pathname.startsWith("/cdn-cgi/") &&
      !/\.svg$/i.test(parsed.pathname)
    );
  };
  const originals = new Set(
    [
      ...imgs.flatMap(urlsOf),
      ...all
        .filter((e) => e.tag === "a" && RASTER_PATH.test(e.attrs.href ?? ""))
        .map((e) => absolute(e.attrs.href)),
    ]
      .filter((u) => u !== null)
      .filter(isOriginal),
  );
  /** @type {Map<string, ImageFile>} */
  const files = new Map();
  await inParallel([...originals], PARALLEL, async (/** @type {string} */ src) => {
    const got = await load(src, READ_LIMIT);
    const file = got.status === 200 ? readImage(got.bytes) : null;
    if (!file) return;
    files.set(src, file);
    const kind = file.type.slice(6).toUpperCase();
    if (file.private.length)
      add(
        "error",
        "D2",
        src,
        `this ${kind} carries ${file.private.join(", ")} in its metadata; strip them before it is published`,
      );
    if (corpOf(got) !== "cross-origin")
      add(
        "error",
        "C11",
        src,
        `Cross-Origin-Resource-Policy is "${corpOf(got) || "unset"}", not cross-origin, so a preview elsewhere may not load it`,
      );
    const etag = got.headers.get("etag");
    if (!etag)
      add("error", "A12", src, "the original has no ETag, so a browser can never revalidate it");
    else {
      const again = await probe(src, { "if-none-match": etag });
      if (again.status !== 304)
        add(
          again.status ? "error" : "unmeasured",
          "A12",
          src,
          `answers ${again.status || again.error} to If-None-Match with its own ETag, not 304`,
        );
    }
  });

  const layouts = VIEWPORTS.map((vp) =>
    placeImages(tree, vp, (img) => files.get(absolute(img.attrs.src) ?? "")),
  );
  /** Where an image sits at each width, and whether it is clearly above or below the fold. @param {El} img */
  const fold = (img) => {
    const tops = layouts.map((l) => l.boxes.get(img)?.top);
    const at = tops
      .map((t, i) => `y≈${t === undefined ? "?" : Math.round(t)} at ${VIEWPORTS[i].width}`)
      .join(", ");
    const known = tops.every((t) => t !== undefined);
    return {
      at,
      above: tops.some((t, i) => t !== undefined && t < ABOVE * VIEWPORTS[i].height),
      below:
        known && tops.every((t, i) => /** @type {number} */ (t) >= BELOW * VIEWPORTS[i].height),
    };
  };

  /** @type {Set<string>} */
  const sizeUrls = new Set();
  let contentImages = 0;
  /** @type {El[]} */
  const high = [];
  for (const img of imgs) {
    const { attrs } = img;
    const src = absolute(attrs.src);
    const label = attrs.src ? shorten(attrs.src) : "an <img> with no src";
    if (attrs.alt === undefined) add("error", "B1", url, `${label} has no alt attribute`);
    else if (isPlaceholderAlt(attrs.alt, src))
      add("error", "B2", url, `${label} has alt "${attrs.alt}", which says nothing about it`);
    if (attrs.width === undefined || attrs.height === undefined)
      add(
        "error",
        "A4",
        url,
        `${label} has no ${attrs.width === undefined ? "width" : "height"} attribute, so the page shifts as it loads`,
      );
    const lazy = attrs.loading?.toLowerCase() === "lazy";
    const priority = attrs.fetchpriority?.toLowerCase() === "high";
    if (priority) high.push(img);
    if (priority && lazy)
      add(
        "error",
        "A5",
        url,
        `${label} is loading="lazy" and fetchpriority="high"; a lazy image is fetched late whatever its priority`,
      );

    const where = fold(img);
    if (where.below) {
      const wrong = [];
      if (!lazy)
        wrong.push(
          attrs.loading ? `loading="${attrs.loading}"` : "not lazy (no loading attribute)",
        );
      if (attrs.decoding?.toLowerCase() !== "async")
        wrong.push(attrs.decoding ? `decoding="${attrs.decoding}"` : 'no decoding="async"');
      if (priority) wrong.push('fetchpriority="high"');
      if (wrong.length)
        add("error", "A6", url, `${label} is below the fold (${where.at}) and ${wrong.join(", ")}`);
    } else if (where.above && lazy)
      add(
        "error",
        "A6",
        url,
        `${label} is loading="lazy" above the fold (${where.at}), so it waits for layout`,
      );

    for (const candidate of urlsOf(img))
      if (onSite(candidate) && new URL(candidate).searchParams.has("w")) sizeUrls.add(candidate);
    const pictureSrcset =
      img.parent?.tag === "picture" &&
      childElements(img.parent).some((s) => s.tag === "source" && Boolean(s.attrs.srcset));
    const responsive =
      pictureSrcset ||
      (Boolean(attrs.srcset) && (Boolean(attrs.sizes) || !/\d\s*w\b/.test(attrs.srcset ?? "")));
    const widthAttr = /^\d+$/.test(attrs.width ?? "") ? Number(attrs.width) : null;
    const file = src ? files.get(src) : undefined;
    const raster = file
      ? RASTER_TYPES.has(file.type)
      : Boolean(src && RASTER_PATH.test(new URL(src).pathname));
    if (
      raster &&
      attrs.alt !== "" &&
      (!main || within(img, ["main"])) &&
      (widthAttr === null || widthAttr >= 200)
    )
      contentImages++;
    const shown = widthAttr ?? file?.width ?? 0;
    if (raster && !responsive && shown > 300)
      add(
        "error",
        "A2",
        url,
        `${label} is ${shown} px wide${widthAttr === null ? " (the file)" : ""} with no srcset and sizes, so every screen downloads the whole of it`,
      );

    VIEWPORTS.forEach((vp, i) => {
      // The slot sizes declares, else the estimated box: the column estimate is the rougher of the two.
      const shownAt = Math.min(
        slotWidth(attrs.sizes, vp) ?? layouts[i].boxes.get(img)?.width ?? 0,
        vp.width,
      );
      const pick = shownAt > 0 ? picked(img, shownAt, vp, absolute, files) : null;
      // A fixed small slot (an icon, 48 px or less) with one file is served at 2x (Cloudflare's responsive-images guidance).
      const slack = shownAt <= SMALL_SLOT && !attrs.srcset ? 2 : 1.5;
      if (pick && pick.width > slack * shownAt * vp.dpr) {
        add(
          "error",
          "A7",
          pick.url,
          `is ${pick.width} px wide for ${label} shown about ${Math.round(shownAt)} px wide at ${vp.width} (DPR ${vp.dpr}) on ${url}: ${(pick.width / (shownAt * vp.dpr)).toFixed(1)} times what the screen needs`,
        );
      }
    });
  }

  // A5: one high image, and the largest image above the fold, when it outweighs the text there, is eager and high.
  if (high.length > 1)
    add(
      "error",
      "A5",
      url,
      `${high.length} images are fetchpriority="high"; only the one that is the largest paint should be`,
    );
  layouts.forEach((layout, i) => {
    const vp = VIEWPORTS[i];
    let lcp = null;
    let area = 0;
    for (const [img, box] of layout.boxes) {
      if (
        img.tag !== "img" ||
        box.top >= ABOVE * vp.height ||
        within(img, ["header", "nav", "footer"])
      )
        continue;
      const seen = box.width * Math.min(box.height, vp.height - box.top);
      if (seen > area) [lcp, area] = [img, seen];
    }
    if (!lcp || area < LCP_AREA || area <= layout.text) return;
    const label = shorten(lcp.attrs.src ?? "an <img>");
    if (lcp.attrs.loading?.toLowerCase() === "lazy")
      add(
        "error",
        "A5",
        url,
        `${label} is the largest image above the fold at ${vp.width} px, likely the largest paint, and it is loading="lazy"`,
      );
    if (lcp.attrs.fetchpriority?.toLowerCase() !== "high")
      add(
        "error",
        "A5",
        url,
        `${label} is the largest image above the fold at ${vp.width} px, likely the largest paint, with no fetchpriority="high"`,
      );
  });

  // A6: a preload, in the page or the Link header, only for an image above the fold.
  const preloadLinks = [
    ...all
      .filter(
        (e) => e.tag === "link" && /\bpreload\b/i.test(e.attrs.rel ?? "") && e.attrs.as === "image",
      )
      .map((e) => e.attrs),
    ...linkHeader(headers.get("link") ?? "").filter(
      (l) => /\bpreload\b/i.test(l.rel ?? "") && l.as === "image",
    ),
  ];
  for (const link of preloadLinks) {
    const named = [link.href, ...candidatesOf(link.imagesrcset).map((c) => c.url)]
      .map(absolute)
      .filter((u) => u !== null);
    const img = imgs.find((i) => urlsOf(i).some((u) => named.includes(u)));
    if (img && fold(img).below)
      add(
        "error",
        "A6",
        url,
        `preloads ${shorten(named[0])}, an image below the fold (${fold(img).at}), ahead of what the screen shows`,
      );
  }

  await auditSizeUrls({ sizeUrls, load, probe, add });

  /** @type {Map<string, string>} */
  const meta = new Map();
  for (const { attrs } of all.filter((e) => e.tag === "meta")) {
    const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
    if (key && attrs.content !== undefined && !meta.has(key)) meta.set(key, attrs.content.trim());
  }
  findings.push(...(await auditShareCard({ url, meta, absolute, load })));

  const robots = [meta.get("robots"), meta.get("googlebot"), headers.get("x-robots-tag")]
    .filter(Boolean)
    .join(", ")
    .toLowerCase();
  if (!/\bnoindex\b/.test(robots) && !/max-image-preview\s*:\s*large/.test(robots)) {
    add(
      "error",
      "C9",
      url,
      "no max-image-preview:large in a robots meta tag or X-Robots-Tag, so search shows a thumbnail at most",
    );
  }

  auditCsp({ headers, all, imgs, urlsOf, origin, url, add });

  if (sitemapImages === false && contentImages > 0)
    add(
      "error",
      "C8",
      url,
      `${contentImages} content image${contentImages === 1 ? "" : "s"} on this page, and its sitemap entry has no image:image`,
    );

  auditMedia({ all, url, absolute, add });
  return findings;
}

/**
 * An alt that names nothing: the file's own name (with or without its extension), "image" or "photo", or a URL.
 * @param {string} alt
 * @param {string | null} src
 */
function isPlaceholderAlt(alt, src) {
  const said = alt.trim().toLowerCase();
  if (!said) return false;
  if (said === "image" || said === "photo" || /^(https?:\/\/|www\.)\S+$/.test(said)) return true;
  if (!src) return false;
  let file = (new URL(src).pathname.split("/").pop() ?? "").toLowerCase();
  try {
    file = decodeURIComponent(file).toLowerCase();
  } catch {} // a malformed %-sequence: the raw name still compares
  return said === file || said === file.replace(/\.[a-z0-9]+$/, "");
}
