#!/usr/bin/env node
/**
 * The live check of a site's images and media (area 6), from its pages as served: no browser, plain fetch and the
 * HTML as written, so an image a script adds later is not seen.
 *
 *   site-runtime-images --origin https://example.com [--from https://example.workers.dev]
 *
 * `--from` fetches from where the site is served now while judging every URL as `--origin`, for a site not yet on its
 * domain. Pages are the home page and the sitemap's (one level of sitemap index), at most 25. Each finding is an
 * annotation line, `::error title=<item>::<proof URL> <detail>` (or `::warning`), the contract devkit-live and
 * prelum-audit keep; exit 0 with no errors, 1 with errors, 2 when it could not run (no origin, home page unreachable).
 *
 * Where an image sits on a 390 px phone (DPR 3) and a 1440 px desktop (DPR 1) is estimated from the HTML (`placeImages`):
 * text, headings, images by their width, height and sizes, and runs of alike cards laid out as a grid. Only an image
 * clearly above the fold (top under 0.8 of the screen) or clearly below it (over 1.1 at both widths) is judged.
 *
 * The items are the area 6 checklist's:
 * - A2 a raster <img> wider than 300 px (its width attribute, else the file) with no srcset and sizes; A3 a /media size
 *   URL that does not answer image/avif for f=avif (a GIF's are skipped: ./image offers a GIF no AVIF; so is a size
 *   over Cloudflare's 1,200 px AVIF limit, and one the route sends on to its WebP because the binding wrote WebP); A4 an <img>
 *   without width and height; A5 more than one fetchpriority=high image, a lazy one, or a largest image above the fold
 *   (bigger than any text there) that is lazy or not high; A6 an image below the fold that is not lazy and async or is
 *   high, a lazy image above it, or a preload of one below it; A7 a file, the srcset candidate a browser picks or the
 *   src, more than 1.5 times its shown width times the DPR; A12 a srcset size URL without `immutable` or that is not an
 *   edge HIT when asked again, and an original with no ETag or that does not answer 304 to it.
 * - B1 an <img> with no alt; B2 an alt that is the file name, "image", "photo" or a URL.
 * - C1 og:image missing, not absolute https, not 200 or not an image; C2 not 1200 by 630 (a warning when at least 1200
 *   wide), or og:image:width, height, type or alt missing or not the file's; C3 twitter:card not summary_large_image,
 *   no twitter:image:alt or one over 420 characters, or og:image:type not the Content-Type served to a crawler and to a
 *   browser, or not the bytes; C8 a sitemap page with content images and no image:image entry; C9 no
 *   max-image-preview:large in robots meta or X-Robots-Tag on an indexed page; C11 a share card or media file without
 *   Cross-Origin-Resource-Policy: cross-origin, or an image the page's CSP img-src refuses.
 * - D2 any original on the site the page shows or links (img src, srcset, a href) whose EXIF or XMP holds GPS, a
 *   serial number, an owner name or a MakerNote.
 * - E1 a youtube.com or Vimeo player embedded directly (no facade), or an iframe with no title; E2 a <video> without a
 *   poster, controls or a captions track, or with preload="auto"; E3 an <audio> without controls (its own, or a player's
 *   buttons around it), preload="none" or, when it has a source, a transcript link on the page.
 *
 * A site whose home page sends a stranger to another host (a sign-in) is one C1 error: a shared link shows no card of
 * its own, and nothing behind the sign-in can be seen.
 *
 * Bounded so a run stays within a few minutes: 25 pages, 6 size URLs a page, 2 MB read from each original, every URL
 * fetched once (and once more for A12).
 */

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { parsePolicy } from "../check.mjs";
import { AVIF_MAX_EDGE } from "../image.mjs";

const MAX_PAGES = 25;
const MAX_SIZE_URLS = 6;
const READ_LIMIT = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const PARALLEL = 4;
const USER_AGENT = "Mozilla/5.0 (compatible; site-runtime-images; +https://github.com/DrDustinEdwards/site-runtime)";
const BROWSER_ACCEPT = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";

/** The two screens the checklist's crawl uses. */
const VIEWPORTS = [
  { width: 390, height: 844, dpr: 3 },
  { width: 1440, height: 900, dpr: 1 },
];
const ABOVE = 0.8;
const BELOW = 1.1;
/** The smallest visible area (CSS px) an image needs to be a page's largest paint rather than an icon. */
const LCP_AREA = 150 * 150;

const RASTER_PATH = /\.(png|jpe?g|webp|avif|gif)(?:$|[?#])/i;
const RASTER_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/avif", "image/gif"]);

/**
 * @typedef {{ severity: "error" | "warning", item: string, url: string, detail: string }} Finding
 * @typedef {{ status: number, type: string, headers: Headers, bytes: Uint8Array, url: string, error?: string }} Fetched
 * @typedef {(url: string, limit?: number, accept?: string) => Promise<Fetched>} Load
 * @typedef {{ tag: string, attrs: Record<string, string | undefined>, children: Array<El | string>, parent: El | null }} El
 * @typedef {{ type: string, width: number, height: number, private: string[] }} ImageFile
 */

/**
 * Every finding for a site, in page order. Throws when the home page cannot be read, so a site that is down never
 * reads as clean.
 * @param {{ origin: string, from?: string, fetch?: typeof fetch, maxPages?: number }} options
 * @returns {Promise<{ pages: string[], findings: Finding[], notes: string[] }>}
 */
export async function auditImages({ origin, from, fetch: get = fetch, maxPages = MAX_PAGES }) {
  const served = (/** @type {string} */ url) => (from && url.startsWith(`${origin}/`) ? from + url.slice(origin.length) : url);
  /** @type {Map<string, Promise<Fetched>>} */
  const fetched = new Map();
  /** @type {Load} One fetch per URL, read limit and Accept; a URL on `origin` is fetched from `from`. */
  const load = (url, limit = 0, accept = "") => {
    const key = `${limit} ${accept} ${url}`;
    if (!fetched.has(key)) fetched.set(key, fetchBytes(get, served(url), limit, accept ? { accept } : {}));
    return /** @type {Promise<Fetched>} */ (fetched.get(key));
  };
  /** A fresh request with these headers, never shared: the second request and the revalidation A12 needs. */
  const probe = (/** @type {string} */ url, /** @type {Record<string, string>} */ headers) => fetchBytes(get, served(url), 0, headers);
  const site = new URL(origin).hostname.replace(/^www\./, "");
  const onSite = (/** @type {string} */ url) => {
    const host = new URL(url).hostname;
    return host === site || host.endsWith(`.${site}`);
  };

  const home = await load(`${origin}/`, Number.POSITIVE_INFINITY);
  if (home.status !== 200) throw new Error(`${origin}/ answered ${home.status || home.error}`);
  // A site behind a sign-in sends a stranger, and a link preview's crawler, to another host: that is all it shows.
  const away = (/** @type {Fetched} */ page) => (page.url && !onSite(page.url) && !(from && page.url.startsWith(`${from}/`)) ? new URL(page.url).host : null);
  if (away(home)) {
    const detail = `sends a stranger to ${away(home)} before any page, so a shared link shows that host's card, not one of the site's own; nothing else is visible to check`;
    return { pages: [`${origin}/`], findings: [{ severity: "error", item: "C1", url: `${origin}/`, detail }], notes: [] };
  }
  const entries = await sitemapEntries(load, origin);
  /** @type {Map<string, boolean>} page URL to whether its sitemap entry lists images; absent for a page not listed */
  const listed = new Map();
  const pages = [`${origin}/`];
  for (const { loc, images } of entries) {
    listed.set(trimSlash(loc), images);
    if (pages.length < maxPages && !pages.some((p) => trimSlash(p) === trimSlash(loc))) pages.push(loc);
  }

  /** @type {Finding[][]} */
  const perPage = pages.map(() => []);
  /** @type {string[]} */
  const notes = [];
  if (entries.length === 0) notes.push(`${origin}/sitemap.xml lists no pages; only the home page was read`);
  await inParallel(pages.map((url, i) => ({ url, i })), PARALLEL, async (job) => {
    const page = await load(job.url, Number.POSITIVE_INFINITY);
    if (page.status !== 200 || !/html/i.test(page.type) || away(page)) {
      notes.push(`${job.url} answered ${page.status || page.error} ${page.type}${away(page) ? ` from ${away(page)}` : ""}; not audited`);
      return;
    }
    const html = new TextDecoder().decode(page.bytes);
    perPage[job.i] = await auditPage({ url: job.url, origin, html, headers: page.headers, load, probe, onSite, sitemapImages: listed.get(trimSlash(job.url)) });
  });
  return { pages, findings: dedupe(perPage.flat()), notes };
}

/**
 * The findings for one page.
 * @param {{ url: string, origin: string, html: string, headers: Headers, load: Load, probe: (url: string, headers: Record<string, string>) => Promise<Fetched>, onSite: (url: string) => boolean, sitemapImages: boolean | undefined }} input
 * @returns {Promise<Finding[]>}
 */
async function auditPage({ url, origin, html, headers, load, probe, onSite, sitemapImages }) {
  /** @type {Finding[]} */
  const findings = [];
  const add = (/** @type {Finding["severity"]} */ severity, /** @type {string} */ item, /** @type {string} */ proof, /** @type {string} */ detail) =>
    findings.push({ severity, item, url: proof, detail });
  const body = html.replace(/<!--[\s\S]*?-->|<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, "");
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
    const sources = img.parent?.tag === "picture" ? childElements(img.parent).filter((c) => c.tag === "source") : [];
    return [img.attrs.src, ...[img, ...sources].flatMap((e) => candidatesOf(e.attrs.srcset).map((c) => c.url))].map(absolute).filter((u) => u !== null);
  };
  const corp = (/** @type {Fetched} */ got) => got.headers.get("cross-origin-resource-policy")?.toLowerCase() ?? "";

  // D2, A12 and C11 on every original the page shows or links; their sizes feed A2, A7 and the layout.
  const isOriginal = (/** @type {string | null} */ href) => {
    if (!href || !onSite(href)) return false;
    const parsed = new URL(href);
    return !parsed.searchParams.has("w") && !parsed.pathname.startsWith("/cdn-cgi/") && !/\.svg$/i.test(parsed.pathname);
  };
  const originals = new Set([...imgs.flatMap(urlsOf), ...all.filter((e) => e.tag === "a" && RASTER_PATH.test(e.attrs.href ?? "")).map((e) => absolute(e.attrs.href))].filter(isOriginal));
  /** @type {Map<string, ImageFile>} */
  const files = new Map();
  await inParallel([...originals], PARALLEL, async (/** @type {string} */ src) => {
    const got = await load(src, READ_LIMIT);
    const file = got.status === 200 ? readImage(got.bytes) : null;
    if (!file) return;
    files.set(src, file);
    const kind = file.type.slice(6).toUpperCase();
    if (file.private.length) add("error", "D2", src, `this ${kind} carries ${file.private.join(", ")} in its metadata; strip them before it is published`);
    if (corp(got) !== "cross-origin") add("error", "C11", src, `Cross-Origin-Resource-Policy is "${corp(got) || "unset"}", not cross-origin, so a preview elsewhere may not load it`);
    const etag = got.headers.get("etag");
    if (!etag) add("error", "A12", src, "the original has no ETag, so a browser can never revalidate it");
    else {
      const again = await probe(src, { "if-none-match": etag });
      if (again.status !== 304) add("error", "A12", src, `answers ${again.status || again.error} to If-None-Match with its own ETag, not 304`);
    }
  });

  const layouts = VIEWPORTS.map((vp) => placeImages(tree, vp, (img) => files.get(absolute(img.attrs.src) ?? "")));
  /** Where an image sits at each width, and whether it is clearly above or below the fold. @param {El} img */
  const fold = (img) => {
    const tops = layouts.map((l) => l.boxes.get(img)?.top);
    const at = tops.map((t, i) => `y≈${t === undefined ? "?" : Math.round(t)} at ${VIEWPORTS[i].width}`).join(", ");
    const known = tops.every((t) => t !== undefined);
    return {
      at,
      above: tops.some((t, i) => t !== undefined && t < ABOVE * VIEWPORTS[i].height),
      below: known && tops.every((t, i) => /** @type {number} */ (t) >= BELOW * VIEWPORTS[i].height),
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
    const proof = src ?? url;
    if (attrs.alt === undefined) add("error", "B1", url, `${label} has no alt attribute`);
    else if (isPlaceholderAlt(attrs.alt, src)) add("error", "B2", url, `${label} has alt "${attrs.alt}", which says nothing about it`);
    if (attrs.width === undefined || attrs.height === undefined) add("error", "A4", url, `${label} has no ${attrs.width === undefined ? "width" : "height"} attribute, so the page shifts as it loads`);
    const lazy = attrs.loading?.toLowerCase() === "lazy";
    const priority = attrs.fetchpriority?.toLowerCase() === "high";
    if (priority) high.push(img);
    if (priority && lazy) add("error", "A5", url, `${label} is loading="lazy" and fetchpriority="high"; a lazy image is fetched late whatever its priority`);

    const where = fold(img);
    if (where.below) {
      const wrong = [];
      if (!lazy) wrong.push(attrs.loading ? `loading="${attrs.loading}"` : "not lazy (no loading attribute)");
      if (attrs.decoding?.toLowerCase() !== "async") wrong.push(attrs.decoding ? `decoding="${attrs.decoding}"` : "no decoding=\"async\"");
      if (priority) wrong.push('fetchpriority="high"');
      if (wrong.length) add("error", "A6", url, `${label} is below the fold (${where.at}) and ${wrong.join(", ")}`);
    } else if (where.above && lazy) add("error", "A6", url, `${label} is loading="lazy" above the fold (${where.at}), so it waits for layout`);

    for (const candidate of urlsOf(img)) if (onSite(candidate) && new URL(candidate).searchParams.has("w")) sizeUrls.add(candidate);
    const pictureSrcset = img.parent?.tag === "picture" && childElements(img.parent).some((s) => s.tag === "source" && Boolean(s.attrs.srcset));
    const responsive = pictureSrcset || (Boolean(attrs.srcset) && (Boolean(attrs.sizes) || !/\d\s*w\b/.test(attrs.srcset ?? "")));
    const widthAttr = /^\d+$/.test(attrs.width ?? "") ? Number(attrs.width) : null;
    const file = src ? files.get(src) : undefined;
    const raster = file ? RASTER_TYPES.has(file.type) : Boolean(src && RASTER_PATH.test(new URL(src).pathname));
    if (raster && attrs.alt !== "" && (!main || within(img, ["main"])) && (widthAttr === null || widthAttr >= 200)) contentImages++;
    const shown = widthAttr ?? file?.width ?? 0;
    if (raster && !responsive && shown > 300) add("error", "A2", url, `${label} is ${shown} px wide${widthAttr === null ? " (the file)" : ""} with no srcset and sizes, so every screen downloads the whole of it`);

    VIEWPORTS.forEach((vp, i) => {
      // The slot sizes declares, else the estimated box: the column estimate is the rougher of the two.
      const shownAt = Math.min(slotWidth(attrs.sizes, vp) ?? layouts[i].boxes.get(img)?.width ?? 0, vp.width);
      const pick = shownAt > 0 ? picked(img, shownAt, vp, absolute, files) : null;
      if (pick && pick.width > 1.5 * shownAt * vp.dpr) {
        add("error", "A7", pick.url, `is ${pick.width} px wide for ${label} shown about ${Math.round(shownAt)} px wide at ${vp.width} (DPR ${vp.dpr}) on ${url}: ${(pick.width / (shownAt * vp.dpr)).toFixed(1)} times what the screen needs`);
      }
    });
  }

  // A5: one high image, and the largest image above the fold, when it outweighs the text there, is eager and high.
  if (high.length > 1) add("error", "A5", url, `${high.length} images are fetchpriority="high"; only the one that is the largest paint should be`);
  layouts.forEach((layout, i) => {
    const vp = VIEWPORTS[i];
    let lcp = null;
    let area = 0;
    for (const [img, box] of layout.boxes) {
      if (img.tag !== "img" || box.top >= ABOVE * vp.height || within(img, ["header", "nav", "footer"])) continue;
      const seen = box.width * Math.min(box.height, vp.height - box.top);
      if (seen > area) [lcp, area] = [img, seen];
    }
    if (!lcp || area < LCP_AREA || area <= layout.text) return;
    const label = shorten(lcp.attrs.src ?? "an <img>");
    if (lcp.attrs.loading?.toLowerCase() === "lazy") add("error", "A5", url, `${label} is the largest image above the fold at ${vp.width} px, likely the largest paint, and it is loading="lazy"`);
    if (lcp.attrs.fetchpriority?.toLowerCase() !== "high") add("error", "A5", url, `${label} is the largest image above the fold at ${vp.width} px, likely the largest paint, with no fetchpriority="high"`);
  });

  // A6: a preload, in the page or the Link header, only for an image above the fold.
  const preloadLinks = [
    ...all.filter((e) => e.tag === "link" && /\bpreload\b/i.test(e.attrs.rel ?? "") && e.attrs.as === "image").map((e) => e.attrs),
    ...linkHeader(headers.get("link") ?? "").filter((l) => /\bpreload\b/i.test(l.rel ?? "") && l.as === "image"),
  ];
  for (const link of preloadLinks) {
    const named = [link.href, ...candidatesOf(link.imagesrcset).map((c) => c.url)].map(absolute).filter((u) => u !== null);
    const img = imgs.find((i) => urlsOf(i).some((u) => named.includes(u)));
    if (img && fold(img).below) add("error", "A6", url, `preloads ${shorten(named[0])}, an image below the fold (${fold(img).at}), ahead of what the screen shows`);
  }

  for (const size of [...sizeUrls].slice(0, MAX_SIZE_URLS)) {
    const got = await load(size);
    if (got.status !== 200) add("error", "A12", size, `answers ${got.status || got.error}`);
    else {
      const cacheControl = got.headers.get("cache-control") ?? "";
      if (!/\bimmutable\b/i.test(cacheControl)) add("error", "A12", size, `Cache-Control is "${cacheControl}", not immutable`);
      const again = await probe(size, {});
      const status = again.headers.get("cf-cache-status");
      if (status?.toUpperCase() !== "HIT") add("error", "A12", size, `asked a second time it is ${status ? `cf-cache-status ${status}` : "not marked by the edge cache (no cf-cache-status)"}, not a HIT`);
      if (corp(got) !== "cross-origin") add("error", "C11", size, `Cross-Origin-Resource-Policy is "${corp(got) || "unset"}", not cross-origin`);
    }
    // A3: the AVIF of the same size, by its .avif name (/media/photo.jpg.webp?w=640) or, on an older site, by f=avif.
    const parsed = new URL(size);
    if (!parsed.pathname.startsWith("/media/") || /\.gif(\.\w+)?$/i.test(parsed.pathname) || /\.avif$/i.test(parsed.pathname)) continue;
    if (/\.\w+\.webp$/i.test(parsed.pathname)) parsed.pathname = parsed.pathname.replace(/\.webp$/i, ".avif");
    else parsed.searchParams.set("f", "avif");
    // Over Cloudflare's AVIF limit (AVIF_MAX_EDGE) the page offers the WebP, and the route sends an AVIF request there.
    if (Number(parsed.searchParams.get("w")) > AVIF_MAX_EDGE) continue;
    const avif = await load(parsed.href);
    const overLimit = avif.status === 200 && /\.webp$/i.test(new URL(avif.url || parsed.href).pathname) && avif.type.toLowerCase().startsWith("image/webp");
    if (!overLimit && (avif.status !== 200 || !avif.type.toLowerCase().startsWith("image/avif"))) add("error", "A3", parsed.href, `answers ${avif.status || avif.error} ${avif.type || "with no type"}, not image/avif`);
  }

  /** @type {Map<string, string>} */
  const meta = new Map();
  for (const { attrs } of all.filter((e) => e.tag === "meta")) {
    const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
    if (key && attrs.content !== undefined && !meta.has(key)) meta.set(key, attrs.content.trim());
  }
  findings.push(...(await shareCard({ url, meta, absolute, load })));

  const robots = [meta.get("robots"), meta.get("googlebot"), headers.get("x-robots-tag")].filter(Boolean).join(", ").toLowerCase();
  if (!/\bnoindex\b/.test(robots) && !/max-image-preview\s*:\s*large/.test(robots)) {
    add("error", "C9", url, "no max-image-preview:large in a robots meta tag or X-Robots-Tag, so search shows a thumbnail at most");
  }

  // C11: the page's CSP (header and meta) lets in every image it shows.
  const policies = [headers.get("content-security-policy"), ...all.filter((e) => /^content-security-policy$/i.test(e.attrs["http-equiv"] ?? "")).map((e) => e.attrs.content)];
  for (const policy of policies) {
    if (!policy) continue;
    const directives = parsePolicy(policy);
    const sources = directives.get("img-src") ?? directives.get("default-src");
    if (!sources) continue;
    for (const img of imgs) {
      const shown = /^data:/i.test(img.attrs.src ?? "") ? ["data:"] : urlsOf(img);
      const refused = shown.find((u) => !imageAllowed(sources, u, origin));
      if (refused) add("error", "C11", url, `the page's CSP img-src (${sources.join(" ")}) refuses ${shorten(refused)}`);
    }
  }

  if (sitemapImages === false && contentImages > 0) add("error", "C8", url, `${contentImages} content image${contentImages === 1 ? "" : "s"} on this page, and its sitemap entry has no image:image`);

  for (const { attrs } of all.filter((e) => e.tag === "iframe")) {
    const src = absolute(attrs.src);
    const label = attrs.src ? shorten(attrs.src) : "an iframe with no src";
    const host = src ? new URL(src).hostname : "";
    if (/(^|\.)youtube\.com$/.test(host) || /(^|\.)vimeo\.com$/.test(host)) {
      add("error", "E1", url, `${label} loads the player with the page; show a poster that loads it on click (a facade)${/youtube/.test(host) ? ", from youtube-nocookie.com" : ""}`);
    }
    if (!attrs.title?.trim()) add("error", "E1", url, `${label} has no title, so a screen reader cannot say what it is`);
  }
  for (const video of all.filter((e) => e.tag === "video")) {
    const { attrs } = video;
    const problems = [];
    if (attrs.poster === undefined) problems.push("no poster");
    if (attrs.controls === undefined) problems.push("no controls");
    if (!descendants(video).some((t) => t.tag === "track" && /^(captions|subtitles)$/i.test(t.attrs.kind ?? ""))) problems.push("no captions <track>");
    if (attrs.preload?.toLowerCase() === "auto") problems.push('preload="auto"');
    if (problems.length) add("error", "E2", url, `${attrs.src ? shorten(attrs.src) : "a <video>"} has ${problems.join(", ")}`);
  }
  const transcript = all.some((e) => e.tag === "a" && /transcript/i.test(`${e.attrs.href ?? ""} ${textOf(e)}`));
  for (const audio of all.filter((e) => e.tag === "audio")) {
    const { attrs } = audio;
    const problems = [];
    // A player of its own counts as controls: buttons beside the <audio> in the element that holds it.
    const player = audio.parent && descendants(audio.parent.parent ?? audio.parent).some((e) => e.tag === "button");
    if (attrs.controls === undefined && !player) problems.push("no controls");
    if (attrs.preload?.toLowerCase() !== "none") problems.push(attrs.preload === undefined ? "no preload=\"none\"" : `preload="${attrs.preload}"`);
    // A sourceless <audio> is a player's one element, which plays what the reader picks later (germomics' dock): the
    // transcript belongs with the episode it is given, not with every page the player sits on.
    const sourced = attrs.src !== undefined || descendants(audio).some((e) => e.tag === "source");
    if (!transcript && sourced) problems.push("no transcript link on the page");
    if (problems.length) add("error", "E3", url, `${attrs.src ? shorten(attrs.src) : "an <audio>"} has ${problems.join(", ")}`);
  }
  return findings;
}

/**
 * C1 to C3 and C11: the page's share card and its tags.
 * @param {{ url: string, meta: Map<string, string>, absolute: (href: string | undefined) => string | null, load: Load }} input
 * @returns {Promise<Finding[]>}
 */
async function shareCard({ url, meta, absolute, load }) {
  /** @type {Finding[]} */
  const findings = [];
  const add = (/** @type {Finding["severity"]} */ severity, /** @type {string} */ item, /** @type {string} */ proof, /** @type {string} */ detail) =>
    findings.push({ severity, item, url: proof, detail });
  const card = meta.get("twitter:card");
  if (card !== "summary_large_image") add("error", "C3", url, card ? `twitter:card is "${card}", not summary_large_image` : "no twitter:card; summary_large_image shows the card full width");
  const alt = meta.get("twitter:image:alt");
  if (!alt) add("error", "C3", url, "no twitter:image:alt");
  else if (alt.length > 420) add("error", "C3", url, `twitter:image:alt is ${alt.length} characters; X cuts it at 420`);

  const image = meta.get("og:image");
  if (!image) {
    add("error", "C1", url, "no og:image, so a shared link has no card");
    return findings;
  }
  if (!/^https:\/\//i.test(image)) add("error", "C1", url, `og:image is "${image}"; previews need an absolute https URL`);
  const src = absolute(image);
  if (!src) return findings;
  const got = await load(src, READ_LIMIT);
  if (got.status !== 200) {
    add("error", "C1", src, `the og:image of ${url} answers ${got.status || got.error}`);
    return findings;
  }
  if (!got.type.toLowerCase().startsWith("image/")) add("error", "C1", src, `the og:image of ${url} is ${got.type || "untyped"}, not an image`);
  const corp = got.headers.get("cross-origin-resource-policy")?.toLowerCase();
  if (corp !== "cross-origin") add("error", "C11", src, `the share card's Cross-Origin-Resource-Policy is "${corp ?? "unset"}", not cross-origin, so a preview on another site may not load it`);
  const file = readImage(got.bytes);
  if (!file) add("error", "C2", src, `the size of the og:image of ${url} cannot be read`);
  else if (file.width !== 1200 || file.height !== 630) {
    add(file.width >= 1200 ? "warning" : "error", "C2", src, `the og:image is ${file.width} by ${file.height}, not 1200 by 630`);
  }
  const missing = ["og:image:width", "og:image:height", "og:image:type", "og:image:alt"].filter((key) => !meta.get(key));
  if (missing.length) add("error", "C3", url, `no ${missing.join(", ")}`);
  const wrong = [];
  if (file && meta.get("og:image:width") && Number(meta.get("og:image:width")) !== file.width) wrong.push(`og:image:width ${meta.get("og:image:width")} (the file is ${file.width})`);
  if (file && meta.get("og:image:height") && Number(meta.get("og:image:height")) !== file.height) wrong.push(`og:image:height ${meta.get("og:image:height")} (the file is ${file.height})`);
  // The type a crawler (Accept */*) and a browser (Accept with AVIF and WebP) are each served, and what the bytes are.
  const said = meta.get("og:image:type")?.toLowerCase();
  const typeOf = (/** @type {Fetched} */ f) => f.type.split(";")[0].trim().toLowerCase();
  const browser = await load(src, 0, BROWSER_ACCEPT);
  const served = [...new Set([typeOf(got), browser.status === 200 ? typeOf(browser) : ""].filter(Boolean))];
  if (said && served.some((t) => t !== said)) wrong.push(`og:image:type ${said} (it is served as ${served.join(" or ")})`);
  if (wrong.length) add("error", "C3", url, `${wrong.join(", ")} does not match the file`);
  if (file && typeOf(got) !== file.type) add("error", "C3", src, `Content-Type is ${typeOf(got) || "unset"}, but the bytes are ${file.type}`);
  return findings;
}

/**
 * The status, type, headers and first `limit` bytes of a URL (all of them for Infinity, none for 0). Never throws: a
 * fetch that fails is status 0 with its error.
 * @param {typeof fetch} get
 * @param {string} url
 * @param {number} limit
 * @param {Record<string, string>} headers
 * @returns {Promise<Fetched>}
 */
async function fetchBytes(get, url, limit, headers) {
  const empty = new Uint8Array(0);
  try {
    const res = await get(url, { headers: { "user-agent": USER_AGENT, ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const head = { status: res.status, type: res.headers.get("content-type") ?? "", headers: res.headers, url: res.url };
    if (limit === 0 || !res.body) {
      await res.body?.cancel();
      return { ...head, bytes: empty };
    }
    /** @type {Uint8Array[]} */
    const chunks = [];
    let length = 0;
    const reader = res.body.getReader();
    while (length < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      length += value.length;
    }
    await reader.cancel();
    const bytes = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    return { ...head, bytes };
  } catch (error) {
    return { status: 0, type: "", headers: new Headers(), bytes: empty, url, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * A raster file's type and pixel size from its first bytes, and the private metadata it carries (`private`: GPS, serial
 * numbers, owner, MakerNote, from EXIF in JPEG APP1, PNG eXIf, WebP EXIF or an AVIF Exif item, or from XMP); null for
 * anything else or too few bytes.
 * @param {Uint8Array} bytes
 * @returns {ImageFile | null}
 */
export function readImage(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (/** @type {number} */ at, /** @type {number} */ length) => String.fromCharCode(...bytes.subarray(at, at + length));
  /** @type {Set<string>} */
  const found = new Set();
  const exif = (/** @type {Uint8Array} */ tiff) => {
    for (const name of privateExif(tiff)) found.add(name);
  };
  const file = (/** @type {string} */ type, /** @type {number} */ width, /** @type {number} */ height) => {
    const text = new TextDecoder("latin1").decode(bytes);
    if (text.includes("<x:xmpmeta")) {
      if (/GPS(Latitude|Longitude)/.test(text)) found.add("GPS (XMP)");
      if (/SerialNumber/.test(text)) found.add("a serial number (XMP)");
      if (/OwnerName/.test(text)) found.add("an owner name (XMP)");
    }
    return { type, width, height, private: [...found] };
  };
  try {
    if (bytes[0] === 0x89 && ascii(1, 3) === "PNG") {
      for (let at = 8; at + 8 <= bytes.length; ) {
        const length = view.getUint32(at);
        if (ascii(at + 4, 4) === "eXIf") exif(bytes.subarray(at + 8, at + 8 + length));
        if (ascii(at + 4, 4) === "IEND") break;
        at += 12 + length;
      }
      return file("image/png", view.getUint32(16), view.getUint32(20));
    }
    if (ascii(0, 4) === "GIF8") return file("image/gif", view.getUint16(6, true), view.getUint16(8, true));
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      for (let at = 2; at + 9 < bytes.length; ) {
        if (bytes[at] !== 0xff) return null;
        const marker = bytes[at + 1];
        if (marker === 0xff || (marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
          at += marker === 0xff ? 1 : 2;
          continue;
        }
        const length = view.getUint16(at + 2);
        if (marker === 0xe1 && ascii(at + 4, 6) === "Exif\0\0") exif(bytes.subarray(at + 10, at + 2 + length));
        // Every start-of-frame marker but DHT (C4), JPG (C8) and DAC (CC) carries the frame's size.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return file("image/jpeg", view.getUint16(at + 7), view.getUint16(at + 5));
        }
        at += 2 + length;
      }
      return null;
    }
    if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
      /** @type {{ width: number, height: number } | null} */
      let size = null;
      for (let at = 12; at + 8 <= bytes.length; ) {
        const fourcc = ascii(at, 4);
        const length = view.getUint32(at + 4, true);
        const data = at + 8;
        const uint24 = (/** @type {number} */ o) => bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16);
        if (fourcc === "VP8X") size = { width: 1 + uint24(data + 4), height: 1 + uint24(data + 7) };
        else if (fourcc === "VP8 " && !size) size = { width: view.getUint16(data + 6, true) & 0x3fff, height: view.getUint16(data + 8, true) & 0x3fff };
        else if (fourcc === "VP8L" && !size) {
          const bits = view.getUint32(data + 1, true);
          size = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
        } else if (fourcc === "EXIF") {
          const block = bytes.subarray(data, data + length);
          exif(ascii(data, 6) === "Exif\0\0" ? block.subarray(6) : block);
        }
        at = data + length + (length % 2);
      }
      return size && file("image/webp", size.width, size.height);
    }
    if (ascii(4, 4) === "ftyp" && /avi[fs]/.test(ascii(8, Math.min(view.getUint32(0), 64) - 8))) {
      // The largest "ispe" (image spatial extents) box is the primary image's; smaller ones are thumbnails or tiles.
      let best = null;
      for (let at = bytes.indexOf(0x69); at !== -1 && at + 16 <= bytes.length; at = bytes.indexOf(0x69, at + 1)) {
        if (ascii(at, 4) !== "ispe") continue;
        const width = view.getUint32(at + 8);
        const height = view.getUint32(at + 12);
        if (!best || width * height > best.width * best.height) best = { width, height };
      }
      // An Exif item is "Exif\0\0" and a TIFF block, wherever the file stores it.
      for (let at = bytes.indexOf(0x45); at !== -1; at = bytes.indexOf(0x45, at + 1)) if (ascii(at, 6) === "Exif\0\0") exif(bytes.subarray(at + 6));
      return best && file("image/avif", best.width, best.height);
    }
  } catch {
    // A truncated or malformed header reads as no image, never as a crash.
  }
  return null;
}

/** EXIF tags in the Exif sub-IFD that say who took a picture or with what. */
const PRIVATE_TAGS = /** @type {Record<number, string>} */ ({ 0x927c: "a MakerNote", 0xa430: "an owner name", 0xa431: "a body serial number", 0xa435: "a lens serial number" });

/**
 * What private metadata a TIFF block (EXIF) holds: a GPS IFD with entries, a camera serial number, and the Exif sub-IFD's
 * private tags.
 * @param {Uint8Array} tiff
 * @returns {string[]}
 */
function privateExif(tiff) {
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return [];
  const entries = (/** @type {number} */ ifd) => Array.from({ length: view.getUint16(ifd, little) }, (_, i) => ifd + 2 + i * 12);
  const found = [];
  try {
    if (view.getUint16(2, little) !== 42) return [];
    for (const entry of entries(view.getUint32(4, little))) {
      const tag = view.getUint16(entry, little);
      if (tag === 0x8825 && view.getUint16(view.getUint32(entry + 8, little), little) > 0) found.push("GPS coordinates");
      if (tag === 0xc62f) found.push("a camera serial number");
      if (tag === 0x8769) for (const sub of entries(view.getUint32(entry + 8, little))) if (PRIVATE_TAGS[view.getUint16(sub, little)]) found.push(PRIVATE_TAGS[view.getUint16(sub, little)]);
    }
  } catch {
    // A block that runs past its end keeps what was read before it.
  }
  return found;
}

/** @param {string} text @returns {Record<string, string | undefined>} */
function attributesOf(text) {
  /** @type {Record<string, string>} */
  const attrs = {};
  for (const a of text.matchAll(/([^\s=/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const key = a[1].toLowerCase();
    if (!(key in attrs)) attrs[key] = decode(a[2] ?? a[3] ?? a[4] ?? "");
  }
  return attrs;
}

/** @param {string} text */
function decode(text) {
  const named = /** @type {Record<string, string>} */ ({ quot: '"', apos: "'", lt: "<", gt: ">", amp: "&", nbsp: " " });
  return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(quot|apos|lt|gt|amp|nbsp));/gi, (whole, hex, dec, name) => {
    if (name) return named[name.toLowerCase()];
    const code = Number.parseInt(hex ?? dec, hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/**
 * The page as a tree of elements and text, tolerant as a browser is: a close tag closes the nearest open element of its
 * name and is ignored when there is none.
 * @param {string} html
 * @returns {El}
 */
function parseTree(html) {
  /** @type {El} */
  const root = { tag: "#root", attrs: {}, children: [], parent: null };
  let node = root;
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g)) {
    if (m[4] !== undefined) {
      if (m[4].trim()) node.children.push(m[4]);
      continue;
    }
    const tag = m[2].toLowerCase();
    if (m[1]) {
      let open = /** @type {El | null} */ (node);
      while (open && open !== root && open.tag !== tag) open = open.parent;
      if (open && open !== root) node = /** @type {El} */ (open.parent);
      continue;
    }
    /** @type {El} */
    const el = { tag, attrs: attributesOf(m[3]), children: [], parent: node };
    node.children.push(el);
    if (!VOID.has(tag) && !m[3].trimEnd().endsWith("/")) node = el;
  }
  return root;
}

/** @param {El} el @returns {El[]} */
function childElements(el) {
  return /** @type {El[]} */ (el.children.filter((c) => typeof c !== "string"));
}

/** Every element under `el`, in document order. @param {El} el @returns {El[]} */
function descendants(el) {
  return childElements(el).flatMap((c) => [c, ...descendants(c)]);
}

/** @param {El} el */
function textOf(el) {
  return el.children.map((c) => (typeof c === "string" ? c : textOf(c))).join(" ");
}

/** The nearest ancestor of `el` with one of these tags. @param {El} el @param {string[]} tags */
function within(el, tags) {
  for (let p = el.parent; p; p = p.parent) if (tags.includes(p.tag)) return p;
  return null;
}

const BLOCK = new Set("address article aside blockquote dd details div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section table tbody thead tr td th ul".split(" "));
const REPLACED = new Set(["img", "svg", "video", "iframe"]);
const HIDDEN = new Set(["head", "title", "dialog", "datalist", "select", "option", "map", "object"]);
/** Font size by tag at [390, 1440]; everything else is body text. */
const FONT = /** @type {Record<string, number[]>} */ ({ h1: [32, 44], h2: [26, 34], h3: [21, 26], h4: [18, 20], h5: [18, 20], h6: [18, 20] });
/** The blocks whose text is one paint, the size an image must beat: a row of links or buttons is many small ones. */
const PROSE = new Set("blockquote dd dt figcaption h1 h2 h3 h4 h5 h6 li p pre td th".split(" "));
const MARGIN = new Set("blockquote dl figure h1 h2 h3 h4 h5 h6 ol p pre section table ul".split(" "));
/** A line of prose stays this wide (CSS px) however wide its column, as sites set a measure. */
const MEASURE = 720;
/** A site header or nav bar: its height, whatever it holds (a phone collapses its links into a menu). */
const BAR = [64, 80];

/**
 * Where each replaced element (img, svg, video, iframe) sits on a screen, estimated from the HTML alone: a fixed bar
 * for a site header or nav, prose as lines of text at a measure, an image at its sizes, else its width attribute
 * capped by its column, at its height-to-width ratio, a narrow image beside others in a row, and a run of alike
 * siblings holding narrow images (cards) as a grid. `text` is the largest visible area of a paragraph, heading or list
 * item above the fold, which an image must beat to be the largest paint.
 * @param {El} root
 * @param {{ width: number, height: number, dpr: number }} vp
 * @param {(img: El) => ImageFile | undefined} fileOf
 */
function placeImages(root, vp, fileOf) {
  const at = vp.width < 800 ? 0 : 1;
  /** @type {Map<El, { top: number, width: number, height: number }>} */
  const boxes = new Map();
  let text = 0;
  const hidden = (/** @type {El} */ el) =>
    HIDDEN.has(el.tag) || el.attrs.hidden !== undefined || /display\s*:\s*none/i.test(el.attrs.style ?? "") || (el.parent?.tag === "details" && el.parent.attrs.open === undefined && el.tag !== "summary");
  /** @param {El} el @param {number} column */
  const boxOf = (el, column) => {
    const number = (/** @type {string | undefined} */ v) => (/^\d+(\.\d+)?$/.test(v ?? "") ? Number(v) : null);
    const file = el.tag === "img" ? fileOf(el) : undefined;
    const viewBox = (el.attrs.viewbox ?? "").split(/[\s,]+/).map(Number);
    const natural = number(el.attrs.width) ?? file?.width ?? (viewBox.length === 4 ? viewBox[2] : null);
    const ratio = (number(el.attrs.height) ?? file?.height ?? (viewBox.length === 4 ? viewBox[3] : null) ?? 0) / (number(el.attrs.width) ?? file?.width ?? viewBox[2] ?? 1);
    const slot = el.tag === "img" ? slotWidth(el.attrs.sizes, vp) : null;
    const width = Math.min(slot ?? natural ?? (el.tag === "img" ? 0 : column), column);
    return { width, height: width * (Number.isFinite(ratio) && ratio > 0 ? ratio : el.tag === "img" ? 0 : 9 / 16) };
  };
  /** The width of the widest replaced element in a card, when it is narrow enough to sit beside another. @param {El} el @param {number} column */
  const cardWidth = (el, column) => {
    const width = Math.max(0, ...descendants(el).filter((d) => REPLACED.has(d.tag)).map((d) => boxOf(d, column).width));
    return width > 0 && width <= column / 2 ? width : 0;
  };
  /** Lays out `el`'s children from `y` in a column; returns the height used. @param {El} el @param {number} y @param {number} column @param {number} font */
  const flow = (el, y, column, font) => {
    let height = 0;
    let chars = 0;
    let rowWidth = 0;
    let rowHeight = 0;
    const endText = () => {
      if (!chars) return;
      const line = Math.min(column, MEASURE);
      const lines = Math.ceil(chars / Math.max(1, Math.floor(line / (font * 0.5))));
      const tall = lines * font * 1.5;
      if (PROSE.has(el.tag) && y + height < vp.height) text = Math.max(text, Math.min(chars * font * 0.5, line) * Math.min(tall, vp.height - y - height));
      height += tall;
      chars = 0;
    };
    const endRow = () => {
      height += rowHeight;
      rowWidth = rowHeight = 0;
    };
    /** @param {Array<El | string>} list */
    const children = (list) => {
      for (let i = 0; i < list.length; i++) {
        const child = list[i];
        if (typeof child === "string") {
          const length = child.replace(/\s+/g, " ").trim().length;
          if (length && rowWidth) endRow();
          chars += length;
          continue;
        }
        if (hidden(child)) continue;
        if ((child.tag === "header" || child.tag === "nav") && !within(child, ["main", "article"])) {
          endText();
          endRow();
          for (const d of descendants(child)) if (REPLACED.has(d.tag)) boxes.set(d, { top: y + height + 8, ...boxOf(d, column) });
          height += BAR[at];
          continue;
        }
        if (REPLACED.has(child.tag)) {
          const box = boxOf(child, column);
          endText();
          if (box.width >= 0.6 * column) {
            endRow();
            boxes.set(child, { top: y + height, ...box });
            height += box.height + 16;
          } else {
            if (rowWidth && rowWidth + box.width > column) endRow();
            boxes.set(child, { top: y + height, ...box });
            rowWidth += box.width + 8;
            rowHeight = Math.max(rowHeight, box.height);
          }
          continue;
        }
        const block = BLOCK.has(child.tag) || (child.tag === "a" && descendants(child).some((d) => REPLACED.has(d.tag) || BLOCK.has(d.tag)));
        if (!block) {
          children(child.children);
          continue;
        }
        endText();
        endRow();
        const card = cardWidth(child, column);
        let last = i;
        const alike = (/** @type {El | string | undefined} */ next) => typeof next !== "string" && next?.tag === child.tag && next.attrs.class === child.attrs.class;
        if (card) while (alike(list[last + 1])) last++;
        if (last > i) {
          const columns = Math.max(1, Math.floor((column * 1.05) / card));
          let tallest = 0;
          for (let k = i; k <= last; k++) {
            if (k > i && (k - i) % columns === 0) {
              height += tallest + 16;
              tallest = 0;
            }
            tallest = Math.max(tallest, flow(/** @type {El} */ (list[k]), y + height, card, font));
          }
          height += tallest + 16;
          i = last;
          continue;
        }
        height += flow(child, y + height, column, FONT[child.tag]?.[at] ?? font) + (MARGIN.has(child.tag) ? 16 : 0);
      }
    };
    children(el.children);
    endText();
    endRow();
    return height;
  };
  const body = descendants(root).find((e) => e.tag === "body") ?? root;
  flow(body, 0, Math.min(vp.width - (at ? 64 : 32), 1200), at ? 18 : 17);
  return { boxes, text };
}

/**
 * The width a `sizes` attribute gives an image on a screen, in CSS px: its first entry whose media condition holds;
 * null when it has none, is `auto`, or cannot be read.
 * @param {string | undefined} sizes
 * @param {{ width: number }} vp
 */
function slotWidth(sizes, vp) {
  for (const entry of splitTop(sizes ?? "")) {
    const m = /^(\(.*\)|not\s.*?\))\s+(\S.*)$/i.exec(entry) ?? /^()(\S.*)$/.exec(entry);
    if (!m || /^auto$/i.test(m[2])) return null;
    if (!m[1] || mediaMatches(m[1], vp)) return cssLength(m[2], vp);
  }
  return null;
}

/**
 * Whether a media condition holds on a screen: widths (min-, max- and the range forms) in px, em or rem, and a light,
 * motion-allowing screen; anything else does not hold. No condition always does.
 * @param {string | undefined} query
 * @param {{ width: number }} vp
 */
function mediaMatches(query, vp) {
  if (!query?.trim()) return true;
  return query.split(/\s*,\s*/).some((alternative) => {
    const negated = /^\s*not\s/i.test(alternative);
    const holds = [...alternative.matchAll(/\(([^()]*)\)/g)].every(([, feature]) => {
      const px = (/** @type {string} */ v) => Number.parseFloat(v) * (/r?em/.test(v) ? 16 : 1);
      const f = feature.trim().toLowerCase();
      let m;
      if ((m = /^min-width\s*:\s*([\d.]+\w*)$/.exec(f))) return vp.width >= px(m[1]);
      if ((m = /^max-width\s*:\s*([\d.]+\w*)$/.exec(f))) return vp.width <= px(m[1]);
      if ((m = /^width\s*(>=|>|<=|<)\s*([\d.]+\w*)$/.exec(f))) return { ">=": vp.width >= px(m[2]), ">": vp.width > px(m[2]), "<=": vp.width <= px(m[2]), "<": vp.width < px(m[2]) }[m[1]];
      return /^prefers-color-scheme\s*:\s*light$|^prefers-reduced-motion\s*:\s*no-preference$|^orientation/.test(f) || f === "";
    });
    return negated ? !holds : holds;
  });
}

/**
 * A CSS length in px on a screen: px, vw, em, rem, and calc(), min(), max() and clamp() of them; null otherwise.
 * @param {string} value
 * @param {{ width: number }} vp
 * @returns {number | null}
 */
function cssLength(value, vp) {
  const v = value.trim().toLowerCase();
  let m;
  if ((m = /^(-?[\d.]+)(px|vw|r?em)?$/.exec(v))) return Number(m[1]) * ({ vw: vp.width / 100, em: 16, rem: 16 }[m[2] ?? "px"] ?? 1);
  if ((m = /^(calc|min|max|clamp)\((.*)\)$/.exec(v))) {
    if (m[1] !== "calc") {
      const args = splitTop(m[2]).map((a) => cssLength(a, vp));
      if (args.some((a) => a === null)) return null;
      const n = /** @type {number[]} */ (args);
      return m[1] === "min" ? Math.min(...n) : m[1] === "max" ? Math.max(...n) : Math.min(Math.max(n[0], n[1]), n[2]);
    }
    let total = 0;
    for (const term of m[2].match(/[+-]?\s*(?:[a-z]+\([^()]*\)|[\d.]+[a-z%]*)/g) ?? []) {
      const sign = term.trim().startsWith("-") ? -1 : 1;
      const length = cssLength(term.replace(/^[+-]\s*/, ""), vp);
      if (length === null) return null;
      total += sign * length;
    }
    return total;
  }
  return null;
}

/** A comma-separated list split only at its top level, so calc(), min() and media queries stay whole. @param {string} text */
function splitTop(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth--;
    else if ((text[i] === "," && depth === 0) || i === text.length) {
      if (text.slice(start, i).trim()) parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  return parts;
}

/**
 * The file a browser downloads for an <img> shown `shown` CSS px wide on a screen, as the HTML standard picks it: the
 * first <picture> source whose media holds, else the img's srcset, its candidate with the least density at or above
 * the DPR (else the densest), or the src. Its width comes from a w descriptor, a ?w= size URL or the file read; null
 * when none says.
 * @param {El} img
 * @param {number} shown
 * @param {{ width: number, dpr: number }} vp
 * @param {(href: string | undefined) => string | null} absolute
 * @param {Map<string, ImageFile>} files
 */
function picked(img, shown, vp, absolute, files) {
  const source = img.parent?.tag === "picture" ? childElements(img.parent).find((s) => s.tag === "source" && s.attrs.srcset && mediaMatches(s.attrs.media, vp)) : undefined;
  const candidates = candidatesOf(source?.attrs.srcset ?? img.attrs.srcset);
  if (candidates.length && candidates.every((c) => !c.w) && !candidates.some((c) => (c.x ?? 1) === 1) && img.attrs.src) candidates.push({ url: img.attrs.src, x: 1 });
  const ranked = candidates.map((c) => ({ url: c.url, density: c.w ? c.w / shown : (c.x ?? 1), w: c.w })).sort((a, b) => a.density - b.density);
  const pick = ranked.find((c) => c.density >= vp.dpr) ?? ranked.at(-1) ?? { url: img.attrs.src ?? "", w: undefined };
  const url = absolute(pick.url);
  if (!url) return null;
  const width = pick.w ?? (Number(new URL(url).searchParams.get("w")) || files.get(url)?.width);
  return width ? { url, width } : null;
}

/**
 * A Link header's entries, each its URL and parameters.
 * @param {string} value
 * @returns {Array<Record<string, string | undefined>>}
 */
function linkHeader(value) {
  return value.split(/,(?=\s*<)/).flatMap((part) => {
    const m = /^\s*<([^>]*)>(.*)$/.exec(part);
    if (!m) return [];
    /** @type {Record<string, string | undefined>} */
    const entry = { href: m[1] };
    for (const p of m[2].matchAll(/;\s*([\w-]+)\s*(?:=\s*(?:"([^"]*)"|([^;\s]*)))?/g)) entry[p[1].toLowerCase()] = p[2] ?? p[3] ?? "";
    return [entry];
  });
}

/**
 * Whether a CSP source list lets an image load: *, 'self', a scheme (data:, https:) or a host source with an optional
 * *. prefix, port and path.
 * @param {string[]} sources
 * @param {string} href the image, or "data:" for a data: URL
 * @param {string} self the page's origin
 */
function imageAllowed(sources, href, self) {
  if (href === "data:") return sources.some((s) => s.toLowerCase() === "data:");
  const u = new URL(href);
  return sources.some((raw) => {
    const s = raw.toLowerCase();
    if (s === "*") return u.protocol === "https:" || u.protocol === "http:";
    if (s === "'self'") return u.origin === self;
    if (/^[a-z][a-z0-9+.-]*:$/.test(s)) return u.protocol === s || (s === "http:" && u.protocol === "https:");
    const m = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([^/:']+)(?::(\d+|\*))?(\/.*)?$/.exec(s);
    if (!m) return false;
    if (m[1] ? m[1] + ":" !== u.protocol && !(m[1] === "http" && u.protocol === "https:") : !/^https?:$/.test(u.protocol)) return false;
    if (m[2] ? !u.hostname.endsWith(`.${m[3]}`) : u.hostname !== m[3]) return false;
    return !m[5] || (m[5].endsWith("/") ? u.pathname.startsWith(m[5]) : u.pathname === m[5]);
  });
}

/**
 * Runs `work` over `items`, `width` at a time.
 * @template T
 * @param {T[]} items
 * @param {number} width
 * @param {(item: T) => Promise<void>} work
 */
async function inParallel(items, width, work) {
  const queue = [...items];
  await Promise.all(Array.from({ length: width }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item);
  }));
}

/**
 * The candidates a srcset names, read as the HTML standard does: a URL runs to whitespace (a comma inside it, as in
 * /cdn-cgi/image/w=640,f=auto/, is part of it), a trailing comma ends a candidate, and descriptors run to a comma.
 * @param {string | undefined} srcset
 * @returns {Array<{ url: string, w?: number, x?: number }>}
 */
function candidatesOf(srcset) {
  /** @type {Array<{ url: string, w?: number, x?: number }>} */
  const candidates = [];
  const text = srcset ?? "";
  let at = 0;
  while (at < text.length) {
    while (at < text.length && /[\s,]/.test(text[at])) at++;
    const start = at;
    while (at < text.length && !/\s/.test(text[at])) at++;
    let url = text.slice(start, at);
    let descriptor = "";
    if (url.endsWith(",")) url = url.replace(/,+$/, "");
    else {
      const from = at;
      while (at < text.length && text[at] !== ",") at++;
      descriptor = text.slice(from, at).trim().toLowerCase();
    }
    const m = /^([\d.]+)([wx])$/.exec(descriptor);
    if (url) candidates.push({ url, ...(m ? { [m[2]]: Number(m[1]) } : {}) });
  }
  return candidates;
}

/**
 * The sitemap's page URLs on `origin`, each with whether its entry lists an image. /sitemap.xml, else the robots.txt
 * Sitemap lines; a sitemap index is followed one level.
 * @param {(url: string, limit?: number) => Promise<Fetched>} load
 * @param {string} origin
 * @returns {Promise<Array<{ loc: string, images: boolean }>>}
 */
async function sitemapEntries(load, origin) {
  const read = async (/** @type {string} */ url, /** @type {boolean} */ index) => {
    const got = await load(url, Number.POSITIVE_INFINITY);
    if (got.status !== 200) return null;
    const xml = new TextDecoder().decode(got.bytes);
    if (/<sitemapindex\b/i.test(xml)) {
      if (!index) return [];
      /** @type {Array<{ loc: string, images: boolean }>} */
      const all = [];
      for (const loc of locs(xml)) all.push(...((await read(loc, false)) ?? []));
      return all;
    }
    return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)].map((m) => ({ loc: locs(m[1])[0], images: /<image:image\b/i.test(m[1]) }));
  };
  let entries = await read(`${origin}/sitemap.xml`, true);
  if (!entries) {
    const robots = await load(`${origin}/robots.txt`, Number.POSITIVE_INFINITY);
    const named = robots.status === 200 ? [...new TextDecoder().decode(robots.bytes).matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]) : [];
    entries = [];
    for (const url of named) entries.push(...((await read(url, true)) ?? []));
  }
  return entries.filter((e) => e.loc === origin || Boolean(e.loc?.startsWith(`${origin}/`)));
}

/** @param {string} xml */
function locs(xml) {
  return [...xml.matchAll(/<loc>\s*([^<]*?)\s*<\/loc>/gi)].map((m) => decode(m[1]));
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
  const file = decodeURIComponent(new URL(src).pathname.split("/").pop() ?? "").toLowerCase();
  return said === file || said === file.replace(/\.[a-z0-9]+$/, "");
}

/** @param {string} url */
function trimSlash(url) {
  return url.replace(/\/$/, "");
}

/** A long URL cut for a finding's detail. @param {string} url */
function shorten(url) {
  return url.length > 120 ? `${url.slice(0, 117)}...` : url;
}

/** The same finding once, so an image repeated on a page is one line. @param {Finding[]} findings */
function dedupe(findings) {
  const seen = new Set();
  return findings.filter((f) => {
    const key = `${f.severity} ${f.item} ${f.url} ${f.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A finding as a GitHub annotation line, escaped as workflow commands require. @param {Finding} finding */
export function annotation({ severity, item, url, detail }) {
  const data = (/** @type {string} */ s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  return `::${severity} title=${data(item).replace(/:/g, "%3A").replace(/,/g, "%2C")}::${data(`${url} ${detail}`)}`;
}

const invokedAs = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : "";
if (import.meta.url === invokedAs) {
  /** @type {{ origin?: string, from?: string }} */
  let values = {};
  try {
    ({ values } = parseArgs({ options: { origin: { type: "string" }, from: { type: "string" } } }));
  } catch {
    // Reported as usage below.
  }
  const bare = (/** @type {string | undefined} */ value) => {
    if (!value) return null;
    try {
      return new URL(/^https?:\/\//.test(value) ? value : `https://${value}`).origin;
    } catch {
      return null;
    }
  };
  const origin = bare(values.origin);
  const from = values.from === undefined ? undefined : bare(values.from);
  if (!origin || from === null) {
    console.error("usage: site-runtime-images --origin <origin> [--from <host>]");
    process.exit(2);
  }
  let report;
  try {
    report = await auditImages({ origin, from: from ?? undefined });
  } catch (error) {
    console.error(`site-runtime-images: could not run: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
  for (const finding of report.findings) console.log(annotation(finding));
  for (const note of report.notes) console.error(`site-runtime-images: ${note}`);
  const errors = report.findings.filter((f) => f.severity === "error").length;
  console.log(`site-runtime-images: ${report.pages.length} pages of ${origin}, ${errors} errors, ${report.findings.length - errors} warnings.`);
  process.exit(errors ? 1 : 0);
}
