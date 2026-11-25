/** What the image audit shares: its typedefs, constants and fetch, and the small helpers every part of it uses. */

import { concatBytes } from "../encoding.mjs";
import { sitemapLocs } from "../html.mjs";
import { errorMessage } from "../log.mjs";

export const MAX_PAGES = 25;
export const MAX_SIZE_URLS = 6;
export const READ_LIMIT = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
export const PARALLEL = 4;
const USER_AGENT =
  "Mozilla/5.0 (compatible; site-runtime-images; +https://github.com/DrDustinEdwards/site-runtime)";
export const BROWSER_ACCEPT = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";

/**
 * @typedef {{ severity: "error" | "warning" | "unmeasured", item: string, url: string, detail: string }} Finding
 * @typedef {{ status: number, type: string, headers: Headers, bytes: Uint8Array, url: string, error?: string }} Fetched
 * @typedef {(url: string, limit?: number, accept?: string) => Promise<Fetched>} Load
 * @typedef {{ tag: string, attrs: Record<string, string | undefined>, children: Array<El | string>, parent: El | null }} El
 * @typedef {import("./image-file.mjs").ImageFile} ImageFile
 */
/** @typedef {(severity: Finding["severity"], item: string, proof: string, detail: string) => unknown} Add */

/** The findings of one part of the audit, and the function that adds one. */
export function collect() {
  /** @type {Finding[]} */
  const findings = [];
  /** @type {Add} */
  const add = (severity, item, proof, detail) =>
    findings.push({ severity, item, url: proof, detail });
  return { findings, add };
}

/** @param {Fetched} got */
export const corpOf = (got) => got.headers.get("cross-origin-resource-policy")?.toLowerCase() ?? "";

/**
 * The status, type, headers and first `limit` bytes of a URL (all of them for Infinity, none for 0). Never throws: a
 * fetch that fails is status 0 with its error.
 * @param {typeof fetch} get
 * @param {string} url
 * @param {number} limit
 * @param {Record<string, string>} headers
 */
export async function fetchBytes(get, url, limit, headers) {
  const empty = new Uint8Array(0);
  try {
    const res = await get(url, {
      headers: { "user-agent": USER_AGENT, ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const head = {
      status: res.status,
      type: res.headers.get("content-type") ?? "",
      headers: res.headers,
      url: res.url,
    };
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
    return { ...head, bytes: concatBytes(...chunks) };
  } catch (error) {
    return {
      status: 0,
      type: "",
      headers: new Headers(),
      bytes: empty,
      url,
      error: errorMessage(error),
    };
  }
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} width
 * @param {(item: T) => Promise<void>} work
 */
export async function inParallel(items, width, work) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: width }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item);
    }),
  );
}

/**
 * The sitemap's page URLs on `origin`, each with whether its entry lists an image. /sitemap.xml, else the robots.txt
 * Sitemap lines; a sitemap index is followed one level.
 * @param {(url: string, limit?: number) => Promise<Fetched>} load
 * @param {string} origin
 * @returns {Promise<Array<{ loc: string, images: boolean }>>}
 */
export async function sitemapPages(load, origin) {
  const read = async (/** @type {string} */ url, /** @type {boolean} */ index) => {
    const got = await load(url, Number.POSITIVE_INFINITY);
    if (got.status !== 200) return null;
    const xml = new TextDecoder().decode(got.bytes);
    if (/<sitemapindex\b/i.test(xml)) {
      if (!index) return [];
      /** @type {Array<{ loc: string, images: boolean }>} */
      const all = [];
      for (const loc of sitemapLocs(xml)) all.push(...((await read(loc, false)) ?? []));
      return all;
    }
    return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)].map((m) => ({
      loc: sitemapLocs(m[1])[0],
      images: /<image:image\b/i.test(m[1]),
    }));
  };
  let entries = await read(`${origin}/sitemap.xml`, true);
  if (!entries) {
    const robots = await load(`${origin}/robots.txt`, Number.POSITIVE_INFINITY);
    const named =
      robots.status === 200
        ? [...new TextDecoder().decode(robots.bytes).matchAll(/^\s*sitemap:\s*(\S+)/gim)].map(
            (m) => m[1],
          )
        : [];
    entries = [];
    for (const url of named) entries.push(...((await read(url, true)) ?? []));
  }
  return entries.filter((e) => e.loc === origin || Boolean(e.loc?.startsWith(`${origin}/`)));
}

/** @param {string} url */
export function trimSlash(url) {
  return url.replace(/\/$/, "");
}

/** A long URL cut for a finding's detail. @param {string} url */
export function shorten(url) {
  return url.length > 120 ? `${url.slice(0, 117)}...` : url;
}

/** The same finding once, so an image repeated on a page is one line. @param {Finding[]} findings */
export function dedupe(findings) {
  const seen = new Set();
  return findings.filter((f) => {
    const key = `${f.severity} ${f.item} ${f.url} ${f.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
