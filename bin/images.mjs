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
 * The items are the area 6 checklist's:
 * - A2 a raster <img> wider than 300 px (its width attribute, else the file) with no srcset and sizes; A3 a /media size
 *   URL that does not answer image/avif for f=avif (a GIF's are skipped: ./image offers a GIF no AVIF); A4 an <img>
 *   without width and height; A5 more than two fetchpriority=high images, or a lazy one; A7 an original with no srcset
 *   more than 1.5 times its width attribute; A12 a srcset size URL without `immutable`.
 * - B1 an <img> with no alt; B2 an alt that is the file name, "image", "photo" or a URL.
 * - C1 og:image missing, not absolute https, not 200 or not an image; C2 not 1200 by 630 (a warning when at least 1200
 *   wide), or og:image:width, height, type or alt missing or not the file's; C3 twitter:card not summary_large_image,
 *   or no twitter:image:alt. C8 (a warning) a sitemap page with content images and no image:image entry.
 * - D2 a JPEG, WebP or PNG original on the site that carries an EXIF GPS IFD.
 * - E1 a youtube.com or Vimeo player embedded directly (no facade), or an iframe with no title; E2 a <video> without a
 *   poster, controls or a captions track, or with preload="auto"; E3 (a warning) an <audio> preloading more than
 *   metadata.
 *
 * Bounded so a run stays under a couple of minutes: 25 pages, 8 originals and 6 size URLs a page, 2 MB read from each
 * original, every URL fetched once.
 */

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const MAX_PAGES = 25;
const MAX_DOWNLOADS = 8;
const MAX_SIZE_URLS = 6;
const READ_LIMIT = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const PARALLEL = 4;
const USER_AGENT = "Mozilla/5.0 (compatible; site-runtime-images; +https://github.com/DrDustinEdwards/site-runtime)";

const RASTER_PATH = /\.(png|jpe?g|webp|avif|gif)(?:$|[?#])/i;
const RASTER_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/avif", "image/gif"]);
const GPS_TYPES = new Set(["image/jpeg", "image/webp", "image/png"]);

/**
 * @typedef {{ severity: "error" | "warning", item: string, url: string, detail: string }} Finding
 * @typedef {{ status: number, type: string, cacheControl: string, bytes: Uint8Array, error?: string }} Fetched
 */

/**
 * Every finding for a site, in page order. Throws when the home page cannot be read, so a site that is down never
 * reads as clean.
 * @param {{ origin: string, from?: string, fetch?: typeof fetch, maxPages?: number }} options
 * @returns {Promise<{ pages: string[], findings: Finding[], notes: string[] }>}
 */
export async function auditImages({ origin, from, fetch: get = fetch, maxPages = MAX_PAGES }) {
  /** @type {Map<string, Promise<Fetched>>} */
  const fetched = new Map();
  /** One fetch per URL and read limit; a URL on `origin` is fetched from `from`. */
  const load = (/** @type {string} */ url, limit = 0) => {
    const key = `${limit} ${url}`;
    if (!fetched.has(key)) fetched.set(key, fetchBytes(get, from && url.startsWith(`${origin}/`) ? from + url.slice(origin.length) : url, limit));
    return /** @type {Promise<Fetched>} */ (fetched.get(key));
  };
  const site = new URL(origin).hostname.replace(/^www\./, "");
  const onSite = (/** @type {string} */ url) => {
    const host = new URL(url).hostname;
    return host === site || host.endsWith(`.${site}`);
  };

  const home = await load(`${origin}/`, Number.POSITIVE_INFINITY);
  if (home.status !== 200) throw new Error(`${origin}/ answered ${home.status || home.error}`);
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
  const queue = pages.map((url, i) => ({ url, i }));
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const page = await load(job.url, Number.POSITIVE_INFINITY);
      if (page.status !== 200 || !/html/i.test(page.type)) {
        notes.push(`${job.url} answered ${page.status || page.error} ${page.type}; not audited`);
        continue;
      }
      const html = new TextDecoder().decode(page.bytes);
      perPage[job.i] = await auditPage({ url: job.url, html, load, onSite, sitemapImages: listed.get(trimSlash(job.url)) });
    }
  }));
  return { pages, findings: dedupe(perPage.flat()), notes };
}

/**
 * The findings for one page.
 * @param {{ url: string, html: string, load: (url: string, limit?: number) => Promise<Fetched>, onSite: (url: string) => boolean, sitemapImages: boolean | undefined }} input
 * @returns {Promise<Finding[]>}
 */
async function auditPage({ url, html, load, onSite, sitemapImages }) {
  /** @type {Finding[]} */
  const findings = [];
  const add = (/** @type {Finding["severity"]} */ severity, /** @type {string} */ item, /** @type {string} */ proof, /** @type {string} */ detail) =>
    findings.push({ severity, item, url: proof, detail });
  const body = html.replace(/<!--[\s\S]*?-->|<(script|style|template)\b[\s\S]*?<\/\1\s*>/gi, "");
  const absolute = (/** @type {string | undefined} */ href) => {
    if (!href || href.startsWith("data:")) return null;
    try {
      return new URL(href, url).href;
    } catch {
      return null;
    }
  };

  // The <img> elements, each with whether a <picture> around it offers a srcset.
  const pictures = [...body.matchAll(/<picture\b[\s\S]*?<\/picture\s*>/gi)].map((m) => ({
    start: /** @type {number} */ (m.index),
    end: /** @type {number} */ (m.index) + m[0].length,
    srcset: elements(m[0], "source").some((s) => Boolean(s.attrs.srcset)),
  }));
  const main = /<main\b[\s\S]*?<\/main\s*>/i.exec(body);
  const imgs = elements(body, "img").map(({ attrs, index }) => ({
    attrs,
    src: absolute(attrs.src),
    inPictureSrcset: pictures.some((p) => index > p.start && index < p.end && p.srcset),
    inMain: !main || (index > /** @type {number} */ (main.index) && index < /** @type {number} */ (main.index) + main[0].length),
  }));

  let downloads = 0;
  /** @type {Set<string>} */
  const sizeUrls = new Set();
  let contentImages = 0;
  let high = 0;
  for (const { attrs, src, inPictureSrcset, inMain } of imgs) {
    const label = attrs.src ? shorten(attrs.src) : "an <img> with no src";
    const proof = src ?? url;
    if (attrs.alt === undefined) add("error", "B1", url, `${label} has no alt attribute`);
    else if (isPlaceholderAlt(attrs.alt, src)) add("error", "B2", url, `${label} has alt "${attrs.alt}", which says nothing about it`);
    if (attrs.width === undefined || attrs.height === undefined) add("error", "A4", url, `${label} has no ${attrs.width === undefined ? "width" : "height"} attribute, so the page shifts as it loads`);
    const priority = attrs.fetchpriority?.toLowerCase() === "high";
    if (priority) high++;
    if (priority && attrs.loading?.toLowerCase() === "lazy") add("error", "A5", url, `${label} is loading="lazy" and fetchpriority="high"; a lazy image is fetched late whatever its priority`);

    for (const candidate of candidatesOf(attrs.srcset)) {
      const size = absolute(candidate);
      if (size && onSite(size) && new URL(size).searchParams.has("w")) sizeUrls.add(size);
    }
    const responsive = inPictureSrcset || (Boolean(attrs.srcset) && (Boolean(attrs.sizes) || !/\d\s*w\b/.test(attrs.srcset ?? "")));
    const widthAttr = /^\d+$/.test(attrs.width ?? "") ? Number(attrs.width) : null;
    let raster = Boolean(src && RASTER_PATH.test(new URL(src).pathname));
    /** @type {{ width: number, height: number } | null} */
    let file = null;
    if (src && onSite(src) && !new URL(src).searchParams.has("w") && downloads < MAX_DOWNLOADS && (raster || !/\.svg$/i.test(new URL(src).pathname))) {
      downloads++;
      const got = await load(src, READ_LIMIT);
      const read = got.status === 200 ? readImage(got.bytes) : null;
      if (read) {
        raster = RASTER_TYPES.has(read.type);
        file = read;
        if (read.gps && GPS_TYPES.has(read.type)) add("error", "D2", src, `this ${read.type.slice(6).toUpperCase()} carries GPS coordinates in its EXIF; strip them before it is published`);
      }
    }
    if (raster && attrs.alt !== "" && inMain && (widthAttr === null || widthAttr >= 200)) contentImages++;
    if (!raster || responsive) continue;
    const shown = widthAttr ?? file?.width ?? 0;
    if (shown > 300) add("error", "A2", url, `${label} is ${shown} px wide${widthAttr === null ? " (the file)" : ""} with no srcset and sizes, so every screen downloads the whole of it`);
    if (file && widthAttr && file.width > 1.5 * widthAttr) add("error", "A7", proof, `the file is ${file.width} px wide for width="${widthAttr}" on ${url}, with no smaller size offered`);
  }
  if (high > 2) add("error", "A5", url, `${high} images are fetchpriority="high"; more than two competes with the one that is the largest paint`);

  for (const size of [...sizeUrls].slice(0, MAX_SIZE_URLS)) {
    const got = await load(size);
    if (got.status !== 200) add("error", "A12", size, `answers ${got.status || got.error}`);
    else if (!/\bimmutable\b/i.test(got.cacheControl)) add("error", "A12", size, `Cache-Control is "${got.cacheControl}", not immutable`);
    const parsed = new URL(size);
    if (!parsed.pathname.startsWith("/media/") || /\.gif$/i.test(parsed.pathname)) continue;
    parsed.searchParams.set("f", "avif");
    const avif = await load(parsed.href);
    if (avif.status !== 200 || !avif.type.toLowerCase().startsWith("image/avif")) add("error", "A3", parsed.href, `answers ${avif.status || avif.error} ${avif.type || "with no type"}, not image/avif`);
  }

  findings.push(...(await shareCard({ url, body, absolute, load, onSite })));

  if (sitemapImages === false && contentImages > 0) add("warning", "C8", url, `${contentImages} content image${contentImages === 1 ? "" : "s"} on this page, and its sitemap entry has no image:image`);

  for (const { attrs } of elements(body, "iframe")) {
    const src = absolute(attrs.src);
    const label = attrs.src ? shorten(attrs.src) : "an iframe with no src";
    const host = src ? new URL(src).hostname : "";
    if (/(^|\.)youtube\.com$/.test(host) || /(^|\.)vimeo\.com$/.test(host)) {
      add("error", "E1", url, `${label} loads the player with the page; show a poster that loads it on click (a facade)${/youtube/.test(host) ? ", from youtube-nocookie.com" : ""}`);
    }
    if (!attrs.title?.trim()) add("error", "E1", url, `${label} has no title, so a screen reader cannot say what it is`);
  }
  for (const m of body.matchAll(/<video\b([^>]*)>([\s\S]*?)<\/video\s*>/gi)) {
    const attrs = attributesOf(m[1]);
    const problems = [];
    if (attrs.poster === undefined) problems.push("no poster");
    if (attrs.controls === undefined) problems.push("no controls");
    if (!elements(m[2], "track").some((t) => /^(captions|subtitles)$/i.test(t.attrs.kind ?? ""))) problems.push("no captions <track>");
    if (attrs.preload?.toLowerCase() === "auto") problems.push('preload="auto"');
    if (problems.length) add("error", "E2", url, `${attrs.src ? shorten(attrs.src) : "a <video>"} has ${problems.join(", ")}`);
  }
  for (const { attrs } of elements(body, "audio")) {
    if (attrs.preload !== undefined && !/^(none|metadata)$/i.test(attrs.preload)) {
      add("warning", "E3", url, `${attrs.src ? shorten(attrs.src) : "an <audio>"} has preload="${attrs.preload}"; none or metadata loads nothing until it is played`);
    }
  }
  return findings;
}

/**
 * C1 to C3: the page's share card and its tags.
 * @param {{ url: string, body: string, absolute: (href: string | undefined) => string | null, load: (url: string, limit?: number) => Promise<Fetched>, onSite: (url: string) => boolean }} input
 * @returns {Promise<Finding[]>}
 */
async function shareCard({ url, body, absolute, load, onSite }) {
  /** @type {Finding[]} */
  const findings = [];
  const add = (/** @type {Finding["severity"]} */ severity, /** @type {string} */ item, /** @type {string} */ proof, /** @type {string} */ detail) =>
    findings.push({ severity, item, url: proof, detail });
  /** @type {Map<string, string>} */
  const meta = new Map();
  for (const { attrs } of elements(body, "meta")) {
    const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
    if (key && attrs.content !== undefined && !meta.has(key)) meta.set(key, attrs.content.trim());
  }
  const card = meta.get("twitter:card");
  if (card !== "summary_large_image") add("error", "C3", url, card ? `twitter:card is "${card}", not summary_large_image` : "no twitter:card; summary_large_image shows the card full width");
  if (!meta.get("twitter:image:alt")) add("error", "C3", url, "no twitter:image:alt");

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
  const file = readImage(got.bytes);
  if (file?.gps && GPS_TYPES.has(file.type) && onSite(src)) add("error", "D2", src, `this ${file.type.slice(6).toUpperCase()} carries GPS coordinates in its EXIF; strip them before it is published`);
  if (!file) add("error", "C2", src, `the size of the og:image of ${url} cannot be read`);
  else if (file.width !== 1200 || file.height !== 630) {
    add(file.width >= 1200 ? "warning" : "error", "C2", src, `the og:image is ${file.width} by ${file.height}, not 1200 by 630`);
  }
  const missing = ["og:image:width", "og:image:height", "og:image:type", "og:image:alt"].filter((key) => !meta.get(key));
  if (missing.length) add("error", "C3", url, `no ${missing.join(", ")}`);
  const wrong = [];
  if (file && meta.get("og:image:width") && Number(meta.get("og:image:width")) !== file.width) wrong.push(`og:image:width ${meta.get("og:image:width")} (the file is ${file.width})`);
  if (file && meta.get("og:image:height") && Number(meta.get("og:image:height")) !== file.height) wrong.push(`og:image:height ${meta.get("og:image:height")} (the file is ${file.height})`);
  const type = got.type.split(";")[0].trim().toLowerCase();
  if (meta.get("og:image:type") && meta.get("og:image:type")?.toLowerCase() !== type) wrong.push(`og:image:type ${meta.get("og:image:type")} (the file is ${type})`);
  if (wrong.length) add("error", "C3", url, `${wrong.join(", ")} does not match the file`);
  return findings;
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
 * The status, type, Cache-Control and first `limit` bytes of a URL (all of them for Infinity, none for 0). Never throws:
 * a fetch that fails is status 0 with its error.
 * @param {typeof fetch} get
 * @param {string} url
 * @param {number} limit
 * @returns {Promise<Fetched>}
 */
async function fetchBytes(get, url, limit) {
  const empty = new Uint8Array(0);
  try {
    const res = await get(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const head = { status: res.status, type: res.headers.get("content-type") ?? "", cacheControl: res.headers.get("cache-control") ?? "" };
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
    return { status: 0, type: "", cacheControl: "", bytes: empty, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * A raster file's type and pixel size from its first bytes, and whether its EXIF holds a GPS IFD (JPEG APP1, PNG eXIf,
 * WebP EXIF); null for anything else or too few bytes.
 * @param {Uint8Array} bytes
 * @returns {{ type: string, width: number, height: number, gps: boolean } | null}
 */
export function readImage(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (/** @type {number} */ at, /** @type {number} */ length) => String.fromCharCode(...bytes.subarray(at, at + length));
  try {
    if (bytes[0] === 0x89 && ascii(1, 3) === "PNG") {
      let gps = false;
      for (let at = 8; at + 8 <= bytes.length; ) {
        const length = view.getUint32(at);
        if (ascii(at + 4, 4) === "eXIf") gps = hasGps(bytes.subarray(at + 8, at + 8 + length));
        if (ascii(at + 4, 4) === "IEND") break;
        at += 12 + length;
      }
      return { type: "image/png", width: view.getUint32(16), height: view.getUint32(20), gps };
    }
    if (ascii(0, 4) === "GIF8") return { type: "image/gif", width: view.getUint16(6, true), height: view.getUint16(8, true), gps: false };
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      let gps = false;
      for (let at = 2; at + 9 < bytes.length; ) {
        if (bytes[at] !== 0xff) return null;
        const marker = bytes[at + 1];
        if (marker === 0xff || (marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
          at += marker === 0xff ? 1 : 2;
          continue;
        }
        const length = view.getUint16(at + 2);
        if (marker === 0xe1 && ascii(at + 4, 6) === "Exif\0\0") gps = gps || hasGps(bytes.subarray(at + 10, at + 2 + length));
        // Every start-of-frame marker but DHT (C4), JPG (C8) and DAC (CC) carries the frame's size.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { type: "image/jpeg", width: view.getUint16(at + 7), height: view.getUint16(at + 5), gps };
        }
        at += 2 + length;
      }
      return null;
    }
    if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
      /** @type {{ width: number, height: number } | null} */
      let size = null;
      let gps = false;
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
          const exif = bytes.subarray(data, data + length);
          gps = hasGps(ascii(data, 6) === "Exif\0\0" ? exif.subarray(6) : exif);
        }
        at = data + length + (length % 2);
      }
      return size && { type: "image/webp", ...size, gps };
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
      return best && { type: "image/avif", ...best, gps: false };
    }
  } catch {
    // A truncated or malformed header reads as no image, never as a crash.
  }
  return null;
}

/**
 * Whether a TIFF block (EXIF) points to a GPS IFD with at least one entry.
 * @param {Uint8Array} tiff
 */
function hasGps(tiff) {
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return false;
  try {
    if (view.getUint16(2, little) !== 42) return false;
    const ifd = view.getUint32(4, little);
    const count = view.getUint16(ifd, little);
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12;
      if (view.getUint16(entry, little) === 0x8825) return view.getUint16(view.getUint32(entry + 8, little), little) > 0;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Every `<name ...>` element's attributes (lower-cased names, entity-decoded values, "" for a bare attribute) and
 * where it starts.
 * @param {string} html
 * @param {string} name
 */
function elements(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, "gi"))].map((m) => ({ attrs: attributesOf(m[1]), index: /** @type {number} */ (m.index) }));
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

/**
 * The URLs a srcset names, read as the HTML standard does: a URL runs to whitespace (a comma inside it, as in
 * /cdn-cgi/image/w=640,f=auto/, is part of it), a trailing comma ends a candidate, and descriptors run to a comma.
 * @param {string | undefined} srcset
 */
function candidatesOf(srcset) {
  /** @type {string[]} */
  const urls = [];
  const text = srcset ?? "";
  let at = 0;
  while (at < text.length) {
    while (at < text.length && /[\s,]/.test(text[at])) at++;
    const start = at;
    while (at < text.length && !/\s/.test(text[at])) at++;
    let url = text.slice(start, at);
    if (url.endsWith(",")) url = url.replace(/,+$/, "");
    else while (at < text.length && text[at] !== ",") at++;
    if (url) urls.push(url);
  }
  return urls;
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
