#!/usr/bin/env node
// site-runtime-speed: the speed and caching check, run against a live site every day (devkit live/areas.json, area 7).
// It reads the site's sitemap, fetches a sample of its pages twice, and checks what a visitor's browser gets: pages
// stored at the edge (B1), nothing personal stored (B4), campaign links on the stored page (B5), validators and 304s
// (B7), year-long hashed files (C1), validators on the rest (C2), compression (C3), HTTP/3 (C4), one redirect at most
// (C5), the preload header and its 103 (D1), our speculation rules on a page with no app (E1), no no-store on a public
// page (E2), the uncached render time (F2), Server-Timing (F3), and PageSpeed Insights' lab and field numbers for the
// home page (A1, A3, D2, D3, D4, D6).
//
//   site-runtime-speed --origin https://example.com [--from https://example.workers.dev] [--max-pages 40] [--kind site]
//
// --from fetches from another host (a site not yet on its domain). --kind static skips what only a Worker does (B4,
// F3). PSI_API_KEY, when set, is a PageSpeed Insights key; without one Google's shared quota may refuse, which is a
// warning. Each finding is a GitHub annotation, `::error title=<item>::<url> <detail>`; exit 1 on any error, 2 when the
// site does not answer, so an outage never reads as findings.

import { connect } from "node:http2";
import { parseArgs } from "node:util";

import { speedFindings } from "../speed.mjs";

const { values } = parseArgs({
  options: { origin: { type: "string" }, from: { type: "string" }, "max-pages": { type: "string", default: "40" }, kind: { type: "string", default: "site" } },
});
if (!values.origin) {
  console.error("usage: site-runtime-speed --origin https://example.com [--from https://preview.example] [--max-pages 40] [--kind site|static]");
  process.exit(2);
}
const origin = values.origin.replace(/\/$/, "");
const base = (values.from ?? values.origin).replace(/\/$/, "");
const maxPages = Number(values["max-pages"]);
// A current Chrome string for every request, the 103 probe too: Cloudflare sends Early Hints only to a browser, so what the
// check sees is what a reader gets. The product name rides in a harmless extra header.
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const CHECK = "site-runtime-speed";
const ENCODINGS = "zstd, br, gzip";
const nonce = () => Math.random().toString(36).slice(2, 10);

/** One GET, never followed, with its time to the first byte. */
async function get(url, headers = {}) {
  const started = performance.now();
  try {
    const response = await fetch(url, { redirect: "manual", headers: { "user-agent": UA, "x-check": CHECK, "accept-encoding": ENCODINGS, ...headers } });
    const ttfb = performance.now() - started;
    const body = (response.headers.get("content-type") ?? "").includes("text/html") ? await response.text() : (await response.arrayBuffer(), "");
    return { url, status: response.status, headers: Object.fromEntries(response.headers), ttfb, body };
  } catch (error) {
    return { url, status: 0, headers: {}, ttfb: 0, body: "", error: String(error?.cause?.code ?? error?.message ?? error) };
  }
}

/** The hops from `url` to the first non-redirect, up to 5. */
async function hops(url) {
  const chain = [];
  let next = url;
  for (let i = 0; i < 5; i++) {
    const r = await get(next);
    chain.push({ url: next, status: r.status });
    if (r.status < 300 || r.status >= 400 || !r.headers.location) break;
    next = new URL(r.headers.location, next).href;
  }
  return chain;
}

/** The status codes of the informational responses (103) before the page's own, over HTTP/2. null when it cannot tell. */
function informational(url) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const session = connect(u.origin);
    const done = (value) => {
      session.close();
      resolve(value);
    };
    session.on("error", () => done(null));
    session.setTimeout(15_000, () => done(null));
    const seen = [];
    const stream = session.request({ ":path": u.pathname + u.search, "user-agent": UA, "x-check": CHECK, "accept-encoding": ENCODINGS });
    stream.on("headers", (headers) => seen.push(Number(headers[":status"])));
    stream.on("response", () => {
      stream.resume();
      done(seen);
    });
    stream.on("error", () => done(null));
    stream.end();
  });
}

/** Cloudflare sends the 103 from a per-URI hint cache that a colo may not hold yet, so one answer with it is enough. */
async function earlyHints(url) {
  let seen = null;
  for (let i = 0; i < 3; i++) {
    const statuses = await informational(url);
    if (statuses?.includes(103)) return statuses;
    seen ??= statuses;
  }
  return seen;
}

/** Every <loc> in the sitemap, following a sitemap index one level. */
async function sitemapUrls() {
  const locs = async (url) => [...(await (await fetch(url, { headers: { "user-agent": UA, "x-check": CHECK } })).text()).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  try {
    const top = await locs(`${base}/sitemap.xml`);
    const nested = top.filter((loc) => /\.xml(\?|$)/.test(loc));
    const pages = top.filter((loc) => !nested.includes(loc));
    for (const loc of nested) pages.push(...(await locs(loc.replace(origin, base))));
    return pages;
  } catch {
    return [];
  }
}

/** Up to `n` URLs, one per first path segment before a second from any, so every page type is in the sample. */
function sample(urls, n) {
  const groups = new Map();
  for (const url of urls) {
    const key = new URL(url).pathname.split("/")[1] ?? "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(url);
  }
  const picked = [];
  for (let round = 0; picked.length < n; round++) {
    let added = false;
    for (const list of groups.values()) {
      if (list[round] && picked.length < n) {
        picked.push(list[round]);
        added = true;
      }
    }
    if (!added) break;
  }
  return picked;
}

/** PageSpeed Insights for the home page, phone and desktop: the Lighthouse result and the field data. */
async function pagespeed(url) {
  const out = {};
  for (const strategy of ["mobile", "desktop"]) {
    const key = process.env.PSI_API_KEY ? `&key=${process.env.PSI_API_KEY}` : "";
    try {
      const r = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&category=performance${key}`);
      out[strategy] = r.ok ? await r.json() : { error: `PageSpeed Insights answered ${r.status}` };
    } catch (error) {
      out[strategy] = { error: `PageSpeed Insights could not be reached: ${error.message}` };
    }
  }
  return out;
}

const home = await get(`${base}/`);
if (home.status === 0 || home.status >= 500) {
  console.error(`site-runtime-speed: ${base} did not answer: ${home.error ?? home.status}`);
  process.exit(2);
}

const listed = (await sitemapUrls()).map((url) => new URL(url.replace(origin, base)).href);
const urls = [...new Set([`${base}/`, ...sample(listed, maxPages)])];
const first = [];
for (const url of urls) first.push(await get(url));
const second = [];
for (const url of urls) second.push(await get(url));
const conditional = [];
for (const page of second) {
  const { etag, "last-modified": lastModified } = page.headers;
  if (page.status === 200 && (etag || lastModified)) {
    conditional.push({ url: page.url, ...(await get(page.url, { ...(etag ? { "if-none-match": etag } : {}), ...(lastModified ? { "if-modified-since": lastModified } : {}) })) });
  }
}
const files = [...new Set([...home.body.matchAll(/(?:href|src)="(\/[^"?#]+\.(?:css|js|woff2|svg|png|webp|avif|jpg|ico))"/g)].map((m) => m[1]))]
  .slice(0, 12)
  .map((path) => `${base}${path}`);
const fileResponses = [];
for (const url of files) fileResponses.push(await get(url));
const misses = [];
for (let i = 0; i < 3; i++) misses.push(await get(`${base}/?speedcheck=${nonce()}`));
const hits = [];
for (let i = 0; i < 3; i++) hits.push(await get(`${base}/`));

const host = new URL(base).host;
const slashPage = urls.find((url) => new URL(url).pathname.length > 1);
const observations = {
  origin,
  base,
  kind: values.kind,
  first,
  second,
  conditional,
  files: fileResponses,
  misses,
  hits,
  withCookie: await get(`${base}/`, { cookie: `speedcheck=${nonce()}` }),
  missing: [await get(`${base}/speedcheck-missing`), await get(`${base}/speedcheck-missing`)],
  campaign: await get(`${base}/?utm_source=speedcheck-${nonce()}`),
  redirects: {
    http: await hops(`http://${host}/`),
    ...(host.split(".").length === 2 ? { www: await hops(`https://www.${host}/`) } : {}),
    ...(slashPage ? { slash: await hops(`${slashPage}/`) } : {}),
  },
  earlyHints: await earlyHints(`${base}/`),
  pagespeed: await pagespeed(`${base}/`),
};

const findings = speedFindings(observations);
for (const finding of findings) console.log(`::${finding.severity} title=${finding.item}::${finding.url} ${finding.detail}`);
const errors = findings.filter((finding) => finding.severity === "error").length;
console.log(`site-runtime-speed: ${urls.length} pages on ${base}; ${errors} errors, ${findings.length - errors} warnings.`);
process.exit(errors > 0 ? 1 : 0);
