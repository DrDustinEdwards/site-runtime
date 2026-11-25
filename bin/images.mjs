#!/usr/bin/env node
/**
 * The live check of a site's images and media (area 6), from its pages as served: no browser, plain fetch and the
 * HTML as written, so an image a script adds later is not seen.
 *
 *   site-runtime-images --origin https://example.com [--from https://example.workers.dev]
 *
 * `--from` fetches from where the site is served now while judging every URL as `--origin`, for a site not yet on its
 * domain. Pages are the home page and the sitemap's (one level of sitemap index), at most 25. Each finding is an
 * annotation line, `::error title=<item>::<proof URL> <detail>` (or `::warning`; what a request that got no answer left
 * unmeasured is `::notice title=<item>::<url> could not measure: <reason>`, exit 3 when nothing failed), the contract
 * devkit-live and prelum-audit keep; exit 0 with no errors, 1 with errors, 2 when it could not run (no origin, home page unreachable).
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
 *   src, more than 1.5 times its shown width times the DPR (2 for a lone-file slot of 48 px or less, an icon); A12 a srcset size URL without `immutable` or that is not an
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

import { errorMessage } from "../log.mjs";
import {
  MAX_PAGES,
  PARALLEL,
  dedupe,
  fetchBytes,
  inParallel,
  sitemapPages,
  trimSlash,
} from "./images-fetch.mjs";
import { auditPage } from "./images-page.mjs";

/** @import { Fetched, Finding, Load } from "./images-fetch.mjs" */

/**
 * Every finding for a site, in page order. Throws when the home page cannot be read, so a site that is down never
 * reads as clean.
 * @param {{ origin: string, from?: string, fetch?: typeof fetch, maxPages?: number }} options
 * @returns {Promise<{ pages: string[], findings: Finding[], notes: string[] }>}
 */
export async function auditImages({ origin, from, fetch: get = fetch, maxPages = MAX_PAGES }) {
  const served = (/** @type {string} */ url) =>
    from && url.startsWith(`${origin}/`) ? from + url.slice(origin.length) : url;
  /** @type {Map<string, Promise<Fetched>>} */
  const fetched = new Map();
  /** @type {Load} One fetch per URL, read limit and Accept; a URL on `origin` is fetched from `from`. */
  const load = (url, limit = 0, accept = "") => {
    const key = `${limit} ${accept} ${url}`;
    if (!fetched.has(key))
      fetched.set(key, fetchBytes(get, served(url), limit, accept ? { accept } : {}));
    return /** @type {Promise<Fetched>} */ (fetched.get(key));
  };
  /** A fresh request with these headers, never shared: the second request and the revalidation A12 needs. */
  const probe = (/** @type {string} */ url, /** @type {Record<string, string>} */ headers) =>
    fetchBytes(get, served(url), 0, headers);
  const site = new URL(origin).hostname.replace(/^www\./, "");
  const onSite = (/** @type {string} */ url) => {
    const host = new URL(url).hostname;
    return host === site || host.endsWith(`.${site}`);
  };

  const home = await load(`${origin}/`, Number.POSITIVE_INFINITY);
  if (home.status !== 200) throw new Error(`${origin}/ answered ${home.status || home.error}`);
  // A site behind a sign-in sends a stranger, and a link preview's crawler, to another host: that is all it shows.
  const away = (/** @type {Fetched} */ page) =>
    page.url && !onSite(page.url) && !(from && page.url.startsWith(`${from}/`))
      ? new URL(page.url).host
      : null;
  if (away(home)) {
    const detail = `sends a stranger to ${away(home)} before any page, so a shared link shows that host's card, not one of the site's own; nothing else is visible to check`;
    return {
      pages: [`${origin}/`],
      findings: [{ severity: "error", item: "C1", url: `${origin}/`, detail }],
      notes: [],
    };
  }
  const entries = await sitemapPages(load, origin);
  /** @type {Map<string, boolean>} page URL to whether its sitemap entry lists images; absent for a page not listed */
  const listed = new Map();
  const pages = [`${origin}/`];
  for (const { loc, images } of entries) {
    listed.set(trimSlash(loc), images);
    if (pages.length < maxPages && !pages.some((p) => trimSlash(p) === trimSlash(loc)))
      pages.push(loc);
  }

  /** @type {Finding[][]} */
  const perPage = pages.map(() => []);
  /** @type {string[]} */
  const notes = [];
  if (entries.length === 0)
    notes.push(`${origin}/sitemap.xml lists no pages; only the home page was read`);
  await inParallel(
    pages.map((url, i) => ({ url, i })),
    PARALLEL,
    async (job) => {
      const page = await load(job.url, Number.POSITIVE_INFINITY);
      // A page that did not answer, or answered a server error, was not audited: its images are not measured, never passed.
      if (page.status === 0 || page.status >= 500) {
        perPage[job.i] = [
          {
            severity: "unmeasured",
            item: "page",
            url: job.url,
            detail: `answered ${page.status || page.error}, so its images and media were not audited`,
          },
        ];
        return;
      }
      if (page.status !== 200 || !/html/i.test(page.type) || away(page)) {
        notes.push(
          `${job.url} answered ${page.status || page.error} ${page.type}${away(page) ? ` from ${away(page)}` : ""}; not audited`,
        );
        return;
      }
      const html = new TextDecoder().decode(page.bytes);
      perPage[job.i] = await auditPage({
        url: job.url,
        origin,
        html,
        headers: page.headers,
        load,
        probe,
        onSite,
        sitemapImages: listed.get(trimSlash(job.url)),
      });
    },
  );
  return { pages, findings: dedupe(perPage.flat()), notes };
}

/** A finding as a GitHub annotation line, escaped as workflow commands require. @param {Finding} finding */
export function annotation({ severity, item, url, detail }) {
  const data = (/** @type {string} */ s) =>
    s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const title = data(item).replace(/:/g, "%3A").replace(/,/g, "%2C");
  // What could not be measured is a notice in devkit-live's form, never a pass or a failure.
  if (severity === "unmeasured")
    return `::notice title=${title}::${data(`${url} could not measure: ${detail}`)}`;
  return `::${severity} title=${title}::${data(`${url} ${detail}`)}`;
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
    console.error(`site-runtime-images: could not run: ${errorMessage(error)}`);
    process.exit(2);
  }
  for (const finding of report.findings) console.log(annotation(finding));
  for (const note of report.notes) console.error(`site-runtime-images: ${note}`);
  const errors = report.findings.filter((f) => f.severity === "error").length;
  const unmeasured = report.findings.filter((f) => f.severity === "unmeasured").length;
  console.log(
    `site-runtime-images: ${report.pages.length} pages of ${origin}, ${errors} errors, ${report.findings.length - errors - unmeasured} warnings, ${unmeasured} not measured.`,
  );
  process.exit(errors ? 1 : unmeasured ? 3 : 0);
}
