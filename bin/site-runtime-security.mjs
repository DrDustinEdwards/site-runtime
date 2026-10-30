#!/usr/bin/env node
/**
 * The live security check for one site, run by devkit-live and by hand:
 *
 *   site-runtime-security --origin https://example.com [--from https://example.workers.dev]
 *
 * `--origin` is the site's address, looked up in the registry (sites.mjs) so the site is graded against what it
 * declared; `--from` is where it is served now, when that differs (a site still on workers.dev). Each finding is one
 * line, `::error title=<item>::<proof URL> <detail>` or `::warning ...`, the item being the checklist id (T1, H2, C6...).
 * Exit 0 with no errors, 1 with any, 2 when it could not run (bad arguments, or the home page could not be fetched).
 *
 * It is gentle: about 15 requests, one at a time, never following a redirect. The home page and a page from
 * /sitemap.xml are graded with their policy; a hashed asset and a static file the home page names, a 404, the HEAD and
 * OPTIONS answers and security.txt are graded without one. It also asks for http:// (a same-host 301 or 308 to https),
 * TRACE (405 or 501), /.git/HEAD, /.env and the asset's .map (404), and fetches / twice when it carries a nonce (two
 * nonces, never one). A redirect to Cloudflare Access is a warning that the page is behind Access, not an error.
 */

import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { parseArgs } from "node:util";
import { checkSecurityHeaders } from "../check.mjs";
import { siteForOrigin } from "../sites.mjs";

const UA = "Mozilla/5.0 (site-runtime-security)";
const DAY = 86_400_000;

let args;
try {
  args = parseArgs({ options: { origin: { type: "string" }, from: { type: "string" } } }).values;
  if (!args.origin) throw new Error("--origin is required");
} catch (error) {
  console.error(`${error instanceof Error ? error.message : error}\nusage: site-runtime-security --origin <origin> [--from <origin>]`);
  process.exit(2);
}
const origin = new URL(args.origin).origin;
const served = new URL(args.from ?? args.origin).origin;
const entry = siteForOrigin(origin) ?? siteForOrigin(served);

let errors = 0;
let warnings = 0;
const printed = new Set();
/** @param {"error" | "warning"} level @param {string} id @param {string} url @param {string} detail */
function report(level, id, url, detail) {
  const line = `::${level} title=${id}::${url} ${detail}`.replace(/\s*\n\s*/g, " ");
  if (printed.has(line)) return;
  printed.add(line);
  console.log(line);
  if (level === "error") errors++;
  else warnings++;
}
if (!entry) report("warning", "registry", origin, "is not in the site registry (sites.mjs): graded against the bare standard");

/** @param {string} path @param {string} [method] */
async function get(path, method = "GET") {
  const url = new URL(path, served).href;
  const res = await fetch(url, { method, redirect: "manual", headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000) });
  return { url, res };
}

let behindAccess = false;
/** True when the response sends the reader to Cloudflare Access; warned once. @param {string} url @param {Response} res */
function accessGate(url, res) {
  const location = res.headers.get("Location");
  if (res.status < 300 || res.status >= 400 || !location) return false;
  const host = new URL(location, url).hostname;
  if (!host.endsWith(".cloudflareaccess.com")) return false;
  if (!behindAccess) report("warning", "A1", url, `is behind Cloudflare Access (${host}): the pages behind it were not graded`);
  behindAccess = true;
  return true;
}

/** Grades one response with the site's entry; the policy only when it is a page. @param {string} url @param {Response} res */
function grade(url, res) {
  if (accessGate(url, res)) return;
  const csp = /^\s*text\/html/i.test(res.headers.get("Content-Type") ?? "");
  for (const r of checkSecurityHeaders(res.headers, { ...(entry ? { site: entry.id } : {}), csp })) {
    if (!r.pass) report(r.warn ? "warning" : "error", r.id, url, `(${res.status}) ${r.name}: ${r.detail}`);
  }
}

/** A path's response, graded, or null after reporting why it could not be fetched. @param {string} path @param {string} [method] */
async function sample(path, method) {
  try {
    const got = await get(path, method);
    grade(got.url, got.res);
    return got;
  } catch (error) {
    report("error", "A1", new URL(path, served).href, `could not be fetched: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/** Expects one of `statuses`; a redirect to Access also passes. @param {string} id @param {string} path @param {number[]} statuses @param {string} why */
async function expectStatus(id, path, statuses, why) {
  try {
    const { url, res } = await get(path);
    await res.body?.cancel();
    if (!statuses.includes(res.status) && !accessGate(url, res)) report("error", id, url, `answers ${res.status}; ${why}`);
  } catch (error) {
    report("error", id, new URL(path, served).href, `could not be fetched: ${error instanceof Error ? error.message : error}`);
  }
}

const NONCE = /'nonce-([^']+)'/;

// The home page. If it cannot be fetched, nothing else is worth asking.
let home;
try {
  home = await get("/");
} catch (error) {
  console.error(`${served}/ could not be fetched: ${error instanceof Error ? error.message : error}`);
  process.exit(2);
}
grade(home.url, home.res);
const homeHtml = /text\/html/i.test(home.res.headers.get("Content-Type") ?? "") ? await home.res.text() : "";
if (homeHtml === "") await home.res.body?.cancel();
if (new URL(served).hostname.endsWith(".workers.dev") && !/noindex/i.test(home.res.headers.get("X-Robots-Tag") ?? "")) {
  report("warning", "A6", home.url, "a workers.dev host without X-Robots-Tag: noindex can be indexed beside the real domain");
}

// C6: a nonce is long enough, on every nonced element, and new on every response.
const nonce = NONCE.exec(home.res.headers.get("Content-Security-Policy") ?? "")?.[1];
if (nonce) {
  if (!/^[A-Za-z0-9+/_-]{22,}={0,2}$/.test(nonce)) report("error", "C6", home.url, `the nonce ${JSON.stringify(nonce)} is under 128 bits of base64`);
  const stale = [...homeHtml.matchAll(/<(?:script|style|link)\b[^>]*\snonce="([^"]*)"/gi)].map((m) => m[1]).filter((n) => n !== nonce);
  if (stale.length > 0) report("error", "C6", home.url, `${stale.length} element(s) carry a nonce the header does not name`);
  try {
    const again = await get("/");
    await again.res.body?.cancel();
    if (NONCE.exec(again.res.headers.get("Content-Security-Policy") ?? "")?.[1] === nonce) {
      report("error", "C6", home.url, "two fetches carried the same nonce: a cached page is replaying it (renewNonce, ./csp)");
    }
  } catch {
    // The first fetch worked; a failed second one proves nothing about the nonce.
  }
}

// A page from the sitemap, when there is one.
const sitemap = await sample("/sitemap.xml");
if (sitemap?.res.status === 200) {
  const loc = /<loc>\s*([^<\s]+)\s*<\/loc>/.exec(await sitemap.res.text())?.[1];
  const page = loc ? new URL(loc.replace(origin, served)) : undefined;
  if (page && page.origin === served && page.pathname !== "/") await sample(`${page.pathname}${page.search}`);
} else {
  await sitemap?.res.body?.cancel();
}

// A hashed asset, its source map, and one other static file the home page names.
const refs = [...homeHtml.matchAll(/\s(?:src|href)="([^"]+)"/gi)]
  .map((m) => new URL((m[1] ?? "").replaceAll("&amp;", "&"), home.url))
  .filter((u) => u.origin === served && /\.[a-z0-9]+$/i.test(u.pathname) && !/\.html?$/i.test(u.pathname));
const asset = refs.find((u) => /[-.][A-Za-z0-9_-]{8,}\.(js|css)$/.test(u.pathname));
const file = refs.find((u) => u.pathname !== asset?.pathname && !/\.(js|css)$/.test(u.pathname)) ?? refs.find((u) => u.pathname !== asset?.pathname);
for (const u of [asset, file]) if (u) (await sample(u.pathname))?.res.body?.cancel();
if (asset) await expectStatus("A5", `${asset.pathname}.map`, [404, 410], "a public source map hands out the source");

// A missing path.
(await sample(`/site-runtime-security-${crypto.randomUUID()}`))?.res.body?.cancel();

// T1: plain http goes to https on the same host, first hop.
try {
  const http = new URL(served);
  http.protocol = "http:";
  const res = await fetch(http, { redirect: "manual", headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000) });
  await res.body?.cancel();
  const to = res.headers.get("Location") ? new URL(res.headers.get("Location") ?? "", http) : undefined;
  if (![301, 308].includes(res.status) || to?.protocol !== "https:" || to.hostname !== http.hostname) {
    report("error", "T1", http.href, `answers ${res.status}${to ? ` to ${to.href}` : ""}; want a 301 or 308 to https on the same host`);
  }
} catch (error) {
  report("error", "T1", `http://${new URL(served).host}/`, `could not be fetched: ${error instanceof Error ? error.message : error}`);
}

// D1-D3: security.txt.
const txt = await sample("/.well-known/security.txt");
if (txt) {
  const body = txt.res.status === 200 ? await txt.res.text() : (await txt.res.body?.cancel(), "");
  if (accessGate(txt.url, txt.res)) {
    report("error", "D1", txt.url, "is behind Cloudflare Access; it must be public (RFC 9116)");
  } else if (txt.res.status !== 200) {
    report("error", "D1", txt.url, `answers ${txt.res.status}`);
  } else {
    const type = txt.res.headers.get("Content-Type") ?? "";
    if (!/^text\/plain\s*;\s*charset=utf-8$/i.test(type.trim())) report("error", "D1", txt.url, `Content-Type is ${JSON.stringify(type)}, not text/plain; charset=utf-8`);
    const fields = (/** @type {string} */ name) => [...body.matchAll(new RegExp(`^${name}:\\s*(.+?)\\s*$`, "gim"))].map((m) => m[1] ?? "");
    if (fields("Contact").length === 0) report("error", "D2", txt.url, "has no Contact");
    const expires = fields("Expires");
    const left = (Date.parse(expires[0] ?? "") - Date.now()) / DAY;
    if (expires.length !== 1) report("error", "D2", txt.url, `has ${expires.length} Expires fields; it needs exactly one`);
    else if (!(left > 0 && left < 365)) report("error", "D2", txt.url, `Expires ${expires[0]} is not in the next year`);
    else if (left < 30) report("warning", "D4", txt.url, `Expires ${expires[0]}, in ${Math.floor(left)} days`);
    const canonical = fields("Canonical");
    const want = [txt.url, new URL("/.well-known/security.txt", origin).href];
    if (canonical.length === 0) report("warning", "D3", txt.url, "has no Canonical");
    else if (!canonical.some((c) => want.includes(c))) report("error", "D3", txt.url, `Canonical ${canonical.join(", ")} does not name the URL it is served from`);
  }
}

// H10: HEAD and OPTIONS answer with the set; TRACE is refused.
(await sample("/", "HEAD"))?.res.body?.cancel();
const options = await sample("/", "OPTIONS");
await options?.res.body?.cancel();
if (options && options.res.status >= 500) report("error", "H10", options.url, `OPTIONS answers ${options.res.status}`);
// fetch refuses to send TRACE, so it goes through node:http(s).
const trace = await new Promise((resolve) => {
  const url = new URL("/", served);
  const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, { method: "TRACE", headers: { "user-agent": UA }, timeout: 20_000 }, (res) => {
    res.resume();
    resolve(res.statusCode ?? 0);
  });
  req.on("timeout", () => req.destroy(new Error("timed out")));
  req.on("error", (error) => resolve(error.message));
  req.end();
});
if (trace !== 405 && trace !== 501) report("error", "H10", `${served}/`, `TRACE answers ${trace}; want 405 or 501`);

// H11: no repository or secrets file is served.
await expectStatus("H11", "/.git/HEAD", [404, 410], "the repository's metadata must not be served");
await expectStatus("H11", "/.env", [404, 410], "a secrets file must not be served");

console.error(`site-runtime-security: ${origin}${served === origin ? "" : ` from ${served}`} (${entry?.id ?? "not in the registry"}): ${errors} errors, ${warnings} warnings`);
process.exit(errors > 0 ? 1 : 0);
