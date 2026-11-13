#!/usr/bin/env node
// site-runtime-speed: the speed and caching check, run against a live site every day (devkit live/areas.json, area 7).
// It reads the site's sitemap, fetches a sample of its pages twice, and checks what a visitor's browser gets: pages
// stored at the edge (B1), nothing personal stored (B4), campaign links on the stored page (B5), validators and 304s
// (B7), year-long hashed files (C1), validators and at most five minutes in the browser for pages and the rest (C2),
// compression (C3), HTTP/3 (C4), one redirect at most from http, www, a page and its other trailing slash, after a same-host http to https upgrade (C5), the
// preload header and its 103 (D1), our speculation rules on a page with no app (E1), no no-store on a public page (E2),
// the uncached render time (F2), Server-Timing (F3), and PageSpeed Insights' lab and field numbers for the home page
// (A1, A3, D2, D3, D4, D6).
//
//   site-runtime-speed --origin https://example.com [--from https://example.workers.dev] [--max-pages 40] [--kind site]
//
// --from fetches from another host (a site not yet on its domain). --kind static skips what only a Worker does (B4,
// F3). PSI_API_KEY, when set, is a PageSpeed Insights key; without one Google's shared quota may refuse. A 429 or 5xx is
// retried with exponential backoff (Retry-After when given), as Google's API guidance asks; a refusal after that leaves
// the PageSpeed items not measured. Each finding is a GitHub annotation, `::error title=<item>::<url> <detail>`; an item
// that could not be measured (that refusal, or a 103 probe that could not read the HTTP/2 answer) is
// `::notice title=<item>::<url> could not measure: <reason>`, never a pass or a failure. Exit 1 on any error, 3 when
// nothing failed but an item was not measured (devkit-live's contract), 2 when the site does not answer, so an outage
// never reads as findings. The 103 probe speaks HTTP/2 itself, so it tunnels through HTTPS_PROXY (HTTP CONNECT, RFC 9110
// 9.3.6) when the environment names one and NO_PROXY does not exempt the host, as fetch's own requests are routed.

import { request } from "node:http";
import { connect } from "node:http2";
import { connect as tlsConnect } from "node:tls";
import { parseArgs } from "node:util";

import { sitemapLocs } from "../html.mjs";
import { retryAfterSeconds } from "../http.mjs";
import { speedFindings } from "../speed.mjs";
import { errorMessage } from "../log.mjs";

const { values } = parseArgs({
  options: {
    origin: { type: "string" },
    from: { type: "string" },
    "max-pages": { type: "string", default: "40" },
    kind: { type: "string", default: "site" },
  },
});
if (!values.origin) {
  console.error(
    "usage: site-runtime-speed --origin https://example.com [--from https://preview.example] [--max-pages 40] [--kind site|static]",
  );
  process.exit(2);
}
const origin = values.origin.replace(/\/$/, "");
const base = (values.from ?? values.origin).replace(/\/$/, "");
const maxPages = Number(values["max-pages"]);
// A current Chrome string for every request, the 103 probe too: Cloudflare sends Early Hints only to a browser, so what the
// check sees is what a reader gets. The product name rides in a harmless extra header.
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const CHECK = "site-runtime-speed";
const ENCODINGS = "zstd, br, gzip";
const nonce = () => Math.random().toString(36).slice(2, 10);

/** @typedef {import("../speed.mjs").Got} Got */

/**
 * One GET, never followed, with its time to the first byte.
 * @param {string} url
 * @param {Record<string, string>} [headers]
 * @returns {Promise<Got>}
 */
async function get(url, headers = {}) {
  const started = performance.now();
  try {
    const response = await fetch(url, {
      redirect: "manual",
      // The signal covers the body too: a site that stops answering ends the read, not the run.
      signal: AbortSignal.timeout(60_000),
      headers: { "user-agent": UA, "x-check": CHECK, "accept-encoding": ENCODINGS, ...headers },
    });
    const ttfb = performance.now() - started;
    const body = (response.headers.get("content-type") ?? "").includes("text/html")
      ? await response.text()
      : (await response.arrayBuffer(), "");
    return {
      url,
      status: response.status,
      headers: Object.fromEntries(response.headers),
      ttfb,
      body,
    };
  } catch (error) {
    const failure =
      /** @type {{ message?: string, cause?: { code?: string } } | null | undefined} */ (error);
    return {
      url,
      status: 0,
      headers: {},
      ttfb: 0,
      body: "",
      error: String(failure?.cause?.code ?? failure?.message ?? error),
    };
  }
}

/** The hops from `url` to the first non-redirect, up to 5. @param {string} url */
async function hops(url) {
  /** @type {{ url: string, status: number }[]} */
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

/** The proxy the environment names for an https URL, unless NO_PROXY exempts its host (curl's rules: a suffix, or *). */
function proxyFor(/** @type {URL} */ u) {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!proxy) return null;
  const host = u.hostname.toLowerCase();
  const exempt = (process.env.NO_PROXY || process.env.no_proxy || "")
    .split(",")
    .map((entry) =>
      entry
        .trim()
        .toLowerCase()
        .replace(/^\*?\./, ""),
    )
    .filter(Boolean);
  if (exempt.some((entry) => entry === "*" || host === entry || host.endsWith(`.${entry}`)))
    return null;
  return new URL(proxy);
}

/** A TLS socket to the host offering only h2, through the proxy's CONNECT tunnel when there is one. */
function h2Socket(/** @type {URL} */ u) {
  return /** @type {Promise<import("node:tls").TLSSocket>} */ (
    new Promise((resolve, reject) => {
      const secure = (/** @type {import("node:stream").Duplex | null} */ socket) => {
        const tls = tlsConnect({
          host: u.hostname,
          port: Number(u.port || 443),
          servername: u.hostname,
          ALPNProtocols: ["h2"],
          ...(socket ? { socket } : {}),
        });
        tls.once("secureConnect", () =>
          tls.alpnProtocol === "h2"
            ? resolve(tls)
            : (tls.destroy(),
              reject(new Error(`the server chose ${tls.alpnProtocol || "no protocol"}, not h2`))),
        );
        tls.once("error", reject);
      };
      const proxy = proxyFor(u);
      if (!proxy) return secure(null);
      const authority = `${u.hostname}:${u.port || 443}`;
      const auth = proxy.username
        ? {
            "proxy-authorization": `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}`,
          }
        : {};
      const tunnel = request({
        host: proxy.hostname,
        port: Number(proxy.port || 80),
        method: "CONNECT",
        path: authority,
        headers: { host: authority, ...auth },
        timeout: 15_000,
      });
      tunnel.once("connect", (res, socket) =>
        res.statusCode === 200
          ? secure(socket)
          : (socket.destroy(),
            reject(new Error(`the proxy answered ${res.statusCode} to CONNECT`))),
      );
      tunnel.once("timeout", () =>
        tunnel.destroy(new Error("the proxy did not answer CONNECT in 15 s")),
      );
      tunnel.once("error", reject);
      tunnel.end();
    })
  );
}

/**
 * The status codes of the informational responses (103) before the page's own, over HTTP/2, or why they could not be read.
 * @param {string} url
 * @returns {Promise<number[] | { error: string }>}
 */
async function informational(url) {
  const u = new URL(url);
  let socket;
  try {
    socket = await h2Socket(u);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  return new Promise((resolve) => {
    const session = connect(u.origin, { createConnection: () => socket });
    let settled = false;
    const done = (/** @type {number[] | { error: string }} */ value) => {
      if (settled) return;
      settled = true;
      session.close();
      resolve(value);
    };
    session.on("error", (error) => done({ error: `HTTP/2: ${error.message}` }));
    session.setTimeout(15_000, () => done({ error: "no HTTP/2 answer in 15 s" }));
    /** @type {number[]} */
    const seen = [];
    const stream = session.request({
      ":path": u.pathname + u.search,
      "user-agent": UA,
      "x-check": CHECK,
      "accept-encoding": ENCODINGS,
    });
    stream.on("headers", (headers) => seen.push(Number(headers[":status"])));
    stream.on("response", () => {
      stream.resume();
      done(seen);
    });
    stream.on("error", (error) => done({ error: `HTTP/2 stream: ${error.message}` }));
    stream.end();
  });
}

/** Cloudflare sends the 103 from a per-URI hint cache that a colo may not hold yet, so one answer with it is enough. @param {string} url */
async function earlyHints(url) {
  /** @type {number[] | { error: string } | null} */
  let seen = null;
  for (let i = 0; i < 3; i++) {
    const statuses = await informational(url);
    if (Array.isArray(statuses) && statuses.includes(103)) return statuses;
    // A read answer outranks an unread one: three reads without a 103 are "no 103", any unread one alone is not measured.
    if (!Array.isArray(seen)) seen = statuses;
  }
  return seen;
}

/** Every <loc> in the sitemap, following a sitemap index one level. */
async function sitemapUrls() {
  const locs = async (/** @type {string} */ url) =>
    sitemapLocs(
      await (
        await fetch(url, {
          headers: { "user-agent": UA, "x-check": CHECK },
          signal: AbortSignal.timeout(60_000),
        })
      ).text(),
    );
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

/**
 * Up to `n` URLs, one per first path segment before a second from any, so every page type is in the sample.
 * @param {string[]} urls
 * @param {number} n
 */
function sample(urls, n) {
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const url of urls) {
    const key = new URL(url).pathname.split("/")[1] ?? "";
    const list = groups.get(key) ?? [];
    groups.set(key, list);
    list.push(url);
  }
  /** @type {string[]} */
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

const PSI_TRIES = 4;
const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * PageSpeed Insights for the home page, phone and desktop: the Lighthouse result and the field data. A 429 or a 5xx is
 * retried with exponential backoff and jitter (Retry-After when the answer gives one, at most a minute).
 * @param {string} url
 */
async function pagespeed(url) {
  /** @type {Parameters<typeof speedFindings>[0]["pagespeed"]} */
  const out = {};
  for (const strategy of ["mobile", "desktop"]) {
    const key = process.env.PSI_API_KEY
      ? `&key=${encodeURIComponent(process.env.PSI_API_KEY)}`
      : "";
    for (let attempt = 1; attempt <= PSI_TRIES; attempt++) {
      try {
        const r = await fetch(
          `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&category=performance${key}`,
        );
        if (r.ok) {
          out[strategy] = await r.json();
          break;
        }
        out[strategy] = {
          error: `PageSpeed Insights answered ${r.status}${attempt > 1 ? ` after ${attempt} tries` : ""}${r.status === 429 && !key ? " (no PSI_API_KEY, so Google's shared keyless quota)" : ""}`,
        };
        if (r.status !== 429 && r.status < 500) break;
        const after = retryAfterSeconds(r.headers);
        if (attempt < PSI_TRIES)
          await sleep(
            Math.min(60_000, after ? after * 1000 : 2 ** attempt * 1000 + Math.random() * 1000),
          );
      } catch (error) {
        out[strategy] = {
          error: `PageSpeed Insights could not be reached: ${errorMessage(error)}`,
        };
        if (attempt < PSI_TRIES) await sleep(2 ** attempt * 1000);
      }
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
    conditional.push(
      await get(page.url, {
        ...(etag ? { "if-none-match": etag } : {}),
        ...(lastModified ? { "if-modified-since": lastModified } : {}),
      }),
    );
  }
}
const files = [
  ...new Set(
    [
      ...home.body.matchAll(
        /(?:href|src)="(\/[^"?#]+\.(?:css|js|woff2|svg|png|webp|avif|jpg|ico))"/g,
      ),
    ].map((m) => m[1]),
  ),
]
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
// A reader also arrives on an old http link to a page, on www, or with the other trailing slash: each of those must take
// one hop too, not only the root.
const deepPath = slashPage ? new URL(slashPage).pathname : null;
const otherSlash = deepPath && (deepPath.endsWith("/") ? deepPath.slice(0, -1) : `${deepPath}/`);
const apex = host.split(".").length === 2;
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
    ...(deepPath
      ? {
          "http page": await hops(`http://${host}${deepPath}`),
          "http page, other slash": await hops(`http://${host}${otherSlash}`),
        }
      : {}),
    ...(apex
      ? { www: await hops(`https://www.${host}/`), "http www": await hops(`http://www.${host}/`) }
      : {}),
    ...(apex && deepPath
      ? { "http www page, other slash": await hops(`http://www.${host}${otherSlash}`) }
      : {}),
    ...(deepPath ? { slash: await hops(`${base}${otherSlash}`) } : {}),
  },
  earlyHints: await earlyHints(`${base}/`),
  pagespeed: await pagespeed(`${base}/`),
};

const findings = speedFindings(observations);
for (const finding of findings) {
  console.log(
    finding.severity === "unmeasured"
      ? `::notice title=${finding.item}::${finding.url} could not measure: ${finding.detail}`
      : `::${finding.severity} title=${finding.item}::${finding.url} ${finding.detail}`,
  );
}
const errors = findings.filter((finding) => finding.severity === "error").length;
const unmeasured = findings.filter((finding) => finding.severity === "unmeasured").length;
console.log(
  `site-runtime-speed: ${urls.length} pages on ${base}; ${errors} errors, ${findings.length - errors - unmeasured} warnings, ${unmeasured} not measured.`,
);
process.exit(errors > 0 ? 1 : unmeasured > 0 ? 3 : 0);
