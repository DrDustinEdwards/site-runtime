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
 * It is gentle: about 25 requests, one at a time, never following a redirect. The home page and a page from
 * /sitemap.xml are graded with their policy; a hashed asset and a static file the home page names, an uploaded file
 * under the entry's `uploads` prefix (A3), a 404, the HEAD and OPTIONS answers and security.txt are graded without one.
 * It also asks for http:// (a same-host 301 or 308 to https), the https redirects of www. and of the sitemap page with
 * its trailing slash turned (HSTS, T2), TRACE and an unknown method (refused), a foreign Origin (never reflected, R5),
 * /account/<name>.css (never a cacheable page, X3), /.git/HEAD and the asset's .map (404), /.env, /.dev.vars and
 * /wrangler.jsonc (never 200), and fetches / twice when it carries a nonce (two nonces, never one). An off-site script
 * or stylesheet with no integrity is a warning (S1). A redirect to Cloudflare Access is a warning that the page is
 * behind Access, not an error, and Access's own 4xx answers on that host are not graded as the site's. A workers.dev
 * host is noindexed exactly while the entry's `oldSite` still serves the old site (A6). A failure the entry declared a deviation for is a warning, and one no family site can
 * meet (FAMILY_DEVIATIONS) a `::notice` line, which fails nothing.
 */

import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { parseArgs } from "node:util";
import { checkSecurityHeaders, checkSecurityTxt, declined } from "../check.mjs";
import { siteForOrigin } from "../sites-values.mjs";

const UA = "Mozilla/5.0 (site-runtime-security)";
const FOREIGN = "https://site-runtime-security.example";

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
/** @param {"error" | "warning" | "notice"} level @param {string} id @param {string} url @param {string} detail */
function report(level, id, url, detail) {
  const line = `::${level} title=${id}::${url} ${detail}`.replace(/\s*\n\s*/g, " ");
  if (printed.has(line)) return;
  printed.add(line);
  console.log(line);
  if (level === "error") errors++;
  else if (level === "warning") warnings++;
}
/** An error, or the warning or notice a declared deviation makes it. @param {string} id @param {string} url @param {string} detail */
function fail(id, url, detail) {
  const deviation = declined(entry, id);
  if (!deviation) return report("error", id, url, detail);
  report(deviation.family ? "notice" : "warning", id, url, `${detail}; declared deviation: ${deviation.reason}`);
}
/** Prints the failed results. @param {string} url @param {number} status @param {import("../check.mjs").CheckResult[]} results */
function print(url, status, results) {
  for (const r of results) if (!r.pass) report(r.notice ? "notice" : r.warn ? "warning" : "error", r.id, url, `(${status}) ${r.name}: ${r.detail}`);
}
if (!entry) report("warning", "registry", origin, "is not in the site registry (sites.mjs): graded against the bare standard");

/** @param {string} path @param {string} [method] */
async function get(path, method = "GET") {
  const url = new URL(path, served).href;
  const res = await fetch(url, { method, redirect: "manual", headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000) });
  return { url, res };
}

let behindAccess = false;
/**
 * True when Cloudflare Access answered instead of the site: a redirect to its sign-in, or, on a host already found
 * behind it, its own 4xx (a 400 or 403 to a request it will not send on, such as an OPTIONS with no preflight), which
 * carries Access's no-cache pair (Expires in 1970 and pre-check=0) and none of the site's set. Warned once.
 * @param {string} url @param {Response} res
 */
function accessGate(url, res) {
  const location = res.headers.get("Location");
  const host = location && res.status >= 300 && res.status < 400 ? new URL(location, url).hostname : "";
  if (host.endsWith(".cloudflareaccess.com")) {
    if (!behindAccess) report("warning", "A1", url, `is behind Cloudflare Access (${host}): the pages behind it were not graded`);
    behindAccess = true;
    return true;
  }
  const own =
    res.status >= 400 && res.status < 500 &&
    (/^\s*Cloudflare-Access\b/i.test(res.headers.get("WWW-Authenticate") ?? "") ||
      (behindAccess && /\bpre-check=0\b/.test(res.headers.get("Cache-Control") ?? "") && /\b1970\b/.test(res.headers.get("Expires") ?? "") && !res.headers.has("X-Content-Type-Options")));
  return own;
}

/**
 * Grades one response with the site's entry; the policy only when it is a page.
 * @param {string} url @param {Response} res @param {{ upload?: boolean, only?: string }} [how] `only`: report that item alone
 */
function grade(url, res, { upload = false, only } = {}) {
  if (accessGate(url, res)) return;
  const csp = !upload && !only && /^\s*text\/html/i.test(res.headers.get("Content-Type") ?? "");
  const results = checkSecurityHeaders(res.headers, { ...(entry ? { site: entry.id } : {}), csp, upload });
  print(url, res.status, only ? results.filter((r) => r.id === only) : results);
}

/** A path's response, graded, or null after reporting why it could not be fetched. @param {string} path @param {string} [method] @param {{ upload?: boolean, only?: string }} [how] */
async function sample(path, method, how) {
  try {
    const got = await get(path, method);
    grade(got.url, got.res, how);
    return got;
  } catch (error) {
    report("error", "A1", new URL(path, served).href, `could not be fetched: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/**
 * Expects one of `statuses`, or with `not: true` anything else; a redirect to Access also passes.
 * @param {string} id @param {string} path @param {number[]} statuses @param {string} why @param {{ not?: boolean, method?: string }} [how]
 */
async function expectStatus(id, path, statuses, why, { not = false, method } = {}) {
  try {
    const { url, res } = await get(path, method);
    await res.body?.cancel();
    if (statuses.includes(res.status) === not && !accessGate(url, res)) report("error", id, url, `${method ? `${method} ` : ""}answers ${res.status}; ${why}`);
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
// A6, one rule for every site (the entry's oldSite): a workers.dev host is noindexed while, and only while, the site's
// real domain still serves a live old site. The host is the site otherwise, and noindex would take it out of search;
// a workers.dev host that is not the entry's origin is a copy beside the real one, so it is always noindexed.
if (new URL(served).hostname.endsWith(".workers.dev")) {
  const noindex = /noindex/i.test(home.res.headers.get("X-Robots-Tag") ?? "");
  const live = entry?.origin === served;
  const old = entry?.oldSite?.value;
  if (!live && !noindex) report("error", "A6", home.url, `a workers.dev copy of ${entry?.origin ?? origin} without X-Robots-Tag: noindex can be indexed beside it`);
  else if (live && old && !noindex) report("error", "A6", home.url, `${old} still serves the old site (oldSite), so this workers.dev host must send X-Robots-Tag: noindex until the domain moves here`);
  else if (live && !old && noindex) report("error", "A6", home.url, "X-Robots-Tag: noindex on the live host: no old site holds the real domain (no oldSite), so this host is the site and noindex takes it out of search");
}

// S1: an off-site script or stylesheet with no integrity runs whatever that host serves tomorrow.
for (const [tag] of homeHtml.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
  if (/^<link/i.test(tag) && !/\srel=["']?stylesheet/i.test(tag)) continue;
  const src = /\s(?:src|href)=["']([^"']+)["']/i.exec(tag)?.[1];
  if (!src || /\sintegrity=/i.test(tag)) continue;
  const at = new URL(src.replaceAll("&amp;", "&"), home.url);
  if (at.origin !== served && at.origin !== origin && /^https?:$/.test(at.protocol)) {
    report("warning", "S1", home.url, `${at.href} loads from another origin with no integrity attribute: self-host it or pin its hash`);
  }
}

// C6: a nonce is long enough, on every nonced element, and new on every response.
const nonce = NONCE.exec(home.res.headers.get("Content-Security-Policy") ?? "")?.[1];
if (nonce) {
  if (!/^[A-Za-z0-9+/_-]{22,}={0,2}$/.test(nonce)) report("error", "C6", home.url, `the nonce ${JSON.stringify(nonce)} is under 128 bits of base64`);
  // A <noscript> body is text to a browser that runs scripts, so a nonce inside it is never presented; a page that
  // parses one later (germomics' hydrate-on-intent) sets its own.
  const live = homeHtml.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "");
  const stale = [...live.matchAll(/<(?:script|style|link)\b[^>]*\snonce="([^"]*)"/gi)].map((m) => m[1]).filter((n) => n !== nonce);
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

// A page from the sitemap, when there is one, and its address with the trailing slash turned, which a site redirects
// (T2: the redirect carries HSTS too).
const sitemap = await sample("/sitemap.xml");
if (sitemap?.res.status === 200) {
  const page = [...(await sitemap.res.text()).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
    .slice(0, 50)
    .map((m) => URL.parse((m[1] ?? "").replace(origin, served)))
    .find((u) => u?.origin === served && u.pathname !== "/");
  if (page) {
    (await sample(`${page.pathname}${page.search}`))?.res.body?.cancel();
    const turned = page.pathname.endsWith("/") ? page.pathname.slice(0, -1) : `${page.pathname}/`;
    const hop = await get(turned).catch(() => null);
    await hop?.res.body?.cancel();
    if (hop && hop.res.status >= 300 && hop.res.status < 400) grade(hop.url, hop.res, { only: "T2" });
  }
} else {
  await sitemap?.res.body?.cancel();
}

// T2: an apex's www. host redirects to it, with HSTS on the redirect. A www. host that does not answer is no finding.
const apex = new URL(served);
if (apex.hostname.split(".").length === 2) {
  const www = await fetch(`https://www.${apex.host}/`, { redirect: "manual", headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000) }).catch(() => null);
  await www?.body?.cancel();
  if (www && www.status >= 300 && www.status < 400) grade(`https://www.${apex.host}/`, www, { only: "T2" });
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

// A3: an uploaded file the home page shows, under the prefix the entry declares.
const uploads = entry?.optIns?.uploads?.value;
const uploaded = uploads ? [...homeHtml.matchAll(/\s(?:src|href|srcset)="([^"\s]+)/gi)].map((m) => new URL((m[1] ?? "").replaceAll("&amp;", "&"), home.url)).find((u) => u.origin === served && u.pathname.startsWith(uploads)) : undefined;
if (uploaded) (await sample(`${uploaded.pathname}${uploaded.search}`, "GET", { upload: true }))?.res.body?.cancel();

// X3: a stylesheet name under a signed-in path is a 404, or at least never a page a shared cache would store as one.
try {
  const { url, res } = await get(`/account/site-runtime-security-${crypto.randomUUID().slice(0, 8)}.css`);
  await res.body?.cancel();
  const cache = res.headers.get("Cache-Control") ?? "";
  if (res.status === 200 && !/(^|,)\s*(no-store|private)\s*(,|$)/i.test(cache)) {
    report("error", "X3", url, `answers 200 (${res.headers.get("Content-Type") ?? "no type"}) with Cache-Control ${JSON.stringify(cache)}: an edge that caches by extension would store a signed-in page for everyone (web cache deception)`);
  }
} catch (error) {
  report("error", "X3", `${served}/account/`, `could not be fetched: ${error instanceof Error ? error.message : error}`);
}

// T1: plain http goes to https on the same host, first hop.
try {
  const http = new URL(served);
  http.protocol = "http:";
  const res = await fetch(http, { redirect: "manual", headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000) });
  await res.body?.cancel();
  const to = res.headers.get("Location") ? new URL(res.headers.get("Location") ?? "", http) : undefined;
  if (![301, 308].includes(res.status) || to?.protocol !== "https:" || to.hostname !== http.hostname) {
    report("error", "T1", http.href, `answers ${res.status}${to ? ` to ${to.href}` : ""}; want a 301 or 308 to https on the same host`);
  } else if (!res.headers.has("Strict-Transport-Security")) {
    fail("T2", http.href, `the redirect to https carries no Strict-Transport-Security`);
  }
} catch (error) {
  report("error", "T1", `http://${new URL(served).host}/`, `could not be fetched: ${error instanceof Error ? error.message : error}`);
}

// D1-D4: security.txt.
const txt = await sample("/.well-known/security.txt");
if (txt) {
  const body = txt.res.status === 200 ? await txt.res.text() : (await txt.res.body?.cancel(), "");
  if (accessGate(txt.url, txt.res)) report("error", "D1", txt.url, "is behind Cloudflare Access; it must be public (RFC 9116)");
  else print(txt.url, txt.res.status, checkSecurityTxt({ url: txt.url, origin, status: txt.res.status, headers: txt.res.headers, body }, entry ? { site: entry } : {}));
}

// H10: HEAD and OPTIONS answer with the set; TRACE and a method nobody defined are refused.
(await sample("/", "HEAD"))?.res.body?.cancel();
const options = await sample("/", "OPTIONS");
await options?.res.body?.cancel();
if (options && options.res.status >= 500) report("error", "H10", options.url, `OPTIONS answers ${options.res.status}`);
await expectStatus("H10", "/", [400, 405, 501], "want 400, 405 or 501 for a method the site does not define", { method: "SITERUNTIME" });

// R5: a foreign Origin is never echoed back as allowed, on a page or a preflight.
for (const method of ["GET", "OPTIONS"]) {
  try {
    const url = new URL("/", served).href;
    const res = await fetch(url, { method, redirect: "manual", headers: { "user-agent": UA, origin: FOREIGN, "access-control-request-method": "POST" }, signal: AbortSignal.timeout(20_000) });
    await res.body?.cancel();
    // Access's own answer (its sign-in redirect echoes the Origin) holds nothing of the site's to read.
    if (accessGate(url, res)) continue;
    const allowed = res.headers.get("Access-Control-Allow-Origin")?.trim();
    const credentials = /^\s*true\s*$/i.test(res.headers.get("Access-Control-Allow-Credentials") ?? "");
    if (allowed === FOREIGN || allowed === "null" || (allowed === "*" && credentials)) {
      report("error", "R5", url, `${method} with Origin ${FOREIGN} answers Access-Control-Allow-Origin: ${allowed}${credentials ? " with credentials" : ""}: any site may read the answer`);
    }
  } catch (error) {
    report("error", "R5", `${served}/`, `could not be fetched: ${error instanceof Error ? error.message : error}`);
  }
}
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

// H11: no repository, secrets or Worker config file is served.
await expectStatus("H11", "/.git/HEAD", [404, 410], "the repository's metadata must not be served");
for (const path of ["/.env", "/.dev.vars", "/wrangler.jsonc"]) await expectStatus("H11", path, [200], "a secrets or config file must not be served", { not: true });

// R4: graded by the site's own code, not from outside (FAMILY_DEVIATIONS).
fail("R4", `${served}/`, "JSON routes refuse text/plain and form bodies: not measurable without a session");

console.error(`site-runtime-security: ${origin}${served === origin ? "" : ` from ${served}`} (${entry?.id ?? "not in the registry"}): ${errors} errors, ${warnings} warnings`);
process.exit(errors > 0 ? 1 : 0);
