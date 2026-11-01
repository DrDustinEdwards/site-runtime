/**
 * The speed and caching findings for one live site, from what `bin/speed.mjs` fetched. Pure: it fetches nothing. Each
 * finding names the checklist item it fails (the reference checklist of the completeness plan, area 7), the URL that
 * shows it and what was seen.
 */

/** cf-cache-status values that mean the page came from the edge. */
const FROM_EDGE = new Set(["HIT", "STALE", "REVALIDATED", "UPDATING"]);

/** Core Web Vitals at the 75th percentile (web.dev/articles/vitals) and the lab bar of the checklist. */
export const BAR = {
  lcpMs: 2500,
  inpMs: 200,
  cls: 0.1,
  fieldTtfbMs: 800,
  hitTtfbMs: 200,
  missTtfbMs: 600,
  missTtfbErrorMs: 1500,
  labPhone: 0.95,
  labDesktop: 1,
  /** The longest a browser may keep a page or an unhashed file without asking again: the five minutes the static sites send. */
  unhashedMaxAgeS: 300,
};

/** Lighthouse audits that each answer one checklist item; a score under 0.9 fails it. */
const AUDITS = {
  "lcp-lazy-loaded": "D2",
  "prioritize-lcp-image": "D2",
  "unsized-images": "D2",
  "font-display": "D3",
  "render-blocking-resources": "D4",
  "unused-css-rules": "D4",
  "unused-javascript": "D4",
  "third-party-summary": "D4",
  "uses-rel-preconnect": "D6",
  "bf-cache": "E2",
  redirects: "C5",
};

/**
 * @typedef {{ url: string, status: number, headers: Record<string, string>, ttfb: number, body: string, error?: string }} Got
 * @typedef {{ item: string, severity: "error" | "warning", url: string, detail: string }} Finding
 */

const median = (/** @type {number[]} */ values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const isHtml = (/** @type {Got} */ got) => (got.headers["content-type"] ?? "").includes("text/html");
/**
 * True for a file a build named by its content: a name ending in a hash-like token, the
 * bundler's `root-DYYv4ssa.css` or `inter-latin-opsz-normal-BwkfbSeq.woff2`. A token is 8 or more letters, digits or
 * underscores after the last hyphen or dot, with a digit or both cases in it. The path does not count: a directory
 * called /assets/ also holds files a site names by hand (the Capsid explorer's), which rightly revalidate. So `apple-touch-icon.png` and
 * `logo-mayo-clinic.svg` (plain words) and `icon-1024x1024.png` (a size) are not hashed and rightly revalidate.
 */
const hashed = (/** @type {string} */ url) => {
  // A bundler's hash is base64url, so it may hold a hyphen (`root-Coj2Oi-v.css`, `lib--DwWN2sy.js`): when no hyphen-free
  // token of 8 or more fits, the last 8 characters after a separator are the hash.
  const token = (/[.-]([A-Za-z0-9_]{8,})\.[a-z0-9]+$/.exec(url) ?? /[.-]([A-Za-z0-9_-]{8})\.[a-z0-9]+$/.exec(url))?.[1];
  return !!token && !/^\d+x\d+$/.test(token) && (/\d/.test(token) || (/[a-z]/.test(token) && /[A-Z]/.test(token)));
};

/** True when a cache-control lets a shared cache keep the response: `public`, or a positive max-age or s-maxage without `private` or `no-store`. */
const allowsStoring = (/** @type {string} */ cacheControl) => {
  const directives = cacheControl.toLowerCase().split(",").map((part) => part.trim());
  if (directives.includes("private") || directives.includes("no-store")) return false;
  return directives.some((part) => part === "public" || /^(max-age|s-maxage)=[1-9]\d*$/.test(part));
};
/** The browser's max-age in seconds (s-maxage is the edge's, so it does not count), 0 when there is none. */
const browserMaxAge = (/** @type {string} */ cacheControl) => Number(/(?:^|,)\s*max-age=(\d+)/i.exec(cacheControl)?.[1] ?? 0);
/** A page or an unhashed file kept longer than the bar: a deploy reaches a returning reader that much later, and a page and its files can expire apart. */
const keptTooLong = (/** @type {string} */ cacheControl) => browserMaxAge(cacheControl) > BAR.unhashedMaxAgeS;
const ms = (/** @type {number} */ n) => `${Math.round(n)} ms`;

/** True when the page runs a React Router app, which prefetches through its own links, not speculation rules. */
const runsApp = (/** @type {string} */ html) => /__reactRouterContext|__remixContext/.test(html);

/**
 * @param {{ origin: string, base: string, kind: string, first: Got[], second: Got[], conditional: Got[], files: Got[],
 *   misses: Got[], hits: Got[], withCookie: Got, missing: Got[], campaign: Got, redirects: Record<string, { url: string, status: number }[]>,
 *   earlyHints: number[] | null, pagespeed: Record<string, any> }} o
 * @returns {Finding[]}
 */
export function speedFindings(o) {
  /** @type {Finding[]} */
  const findings = [];
  const add = (item, severity, url, detail) => findings.push({ item, severity, url, detail });
  const worker = o.kind !== "static";
  const pages = o.second.filter((got) => got.status === 200 && isHtml(got));
  const home = o.second[0];

  for (const got of o.second) {
    if (got.status !== 200) add("B1", "error", got.url, `a sitemap page answered ${got.status || got.error}`);
  }
  for (const got of pages) {
    const status = got.headers["cf-cache-status"] ?? "none";
    if (!FROM_EDGE.has(status)) {
      // What the first request saw and where each was answered, so a miss says whether the page was never stored, was
      // purged between the two, or was answered by another data center (cf-ray ends in the colo).
      const before = o.first.find((f) => f.url === got.url);
      const colo = (g) => g?.headers["cf-ray"]?.split("-").pop() ?? "?";
      add("B1", "error", got.url, `not from the edge on the second request: cf-cache-status ${status} (first ${before?.headers["cf-cache-status"] ?? "none"}), cache-control ${got.headers["cache-control"] ?? "none"}, colo ${colo(before)} then ${colo(got)}`);
    }
    if (!got.headers.etag && !got.headers["last-modified"]) add("B7", "error", got.url, "no ETag or Last-Modified, so a repeat visit downloads the page again");
    if (!/^(zstd|br)$/.test(got.headers["content-encoding"] ?? "")) add("C3", "error", got.url, `HTML sent ${got.headers["content-encoding"] ?? "uncompressed"}, not zstd or Brotli`);
    if (/no-store/.test(got.headers["cache-control"] ?? "")) add("E2", "error", got.url, "a public page sent no-store, which keeps it out of the back/forward cache");
    if (keptTooLong(got.headers["cache-control"] ?? "")) add("C2", "error", got.url, `a page sent cache-control ${got.headers["cache-control"]}: browsers keep it over ${BAR.unhashedMaxAgeS} s without asking, so a deploy reaches returning readers late`);
    if (worker && !got.headers["server-timing"]) add("F3", "error", got.url, "no Server-Timing header");
    if (!/rel=("|)preload/.test(got.headers.link ?? "")) add("D1", "error", got.url, "no Link preload header for Early Hints");
  }
  for (const got of o.conditional) {
    if (got.status !== 304) add("B7", "error", got.url, `a conditional request with the page's own validator answered ${got.status}, not 304`);
  }

  if (worker) {
    if (!/private|no-store/.test(o.withCookie.headers["cache-control"] ?? "")) {
      add("B4", "error", o.withCookie.url, `a request with a cookie got cache-control ${o.withCookie.headers["cache-control"] ?? "none"}, not private`);
    }
  }
  // A 404 is judged by what it was told to do. Workers static assets report cf-cache-status HIT for their shared 404
  // page whatever it says and send no Age, so a HIT alone proves nothing there: a 404 that forbids storing fails only
  // with an Age (it was really stored), one with no cache-control at all (a Worker's own page) fails on the HIT.
  const missingAgain = o.missing.at(-1);
  if (missingAgain) {
    const cc = missingAgain.headers["cache-control"] ?? "";
    const fromEdge = FROM_EDGE.has(missingAgain.headers["cf-cache-status"] ?? "");
    const aged = Number(missingAgain.headers.age) > 0;
    if (allowsStoring(cc)) add("B4", "error", missingAgain.url, `a ${missingAgain.status} sent cache-control ${cc}, which lets the edge store it`);
    else if (fromEdge && (aged || !cc)) add("B4", "error", missingAgain.url, `a ${missingAgain.status} was stored and served from the edge${aged ? ` (age ${missingAgain.headers.age})` : ""}`);
  }
  if (home && FROM_EDGE.has(home.headers["cf-cache-status"] ?? "") && !FROM_EDGE.has(o.campaign.headers["cf-cache-status"] ?? "")) {
    add("B5", "error", o.campaign.url, `a campaign link missed the stored home page: cf-cache-status ${o.campaign.headers["cf-cache-status"] ?? "none"}`);
  }

  for (const got of o.files) {
    const cc = got.headers["cache-control"] ?? "";
    if (got.status !== 200) continue;
    if (hashed(got.url)) {
      if (!/max-age=31536000/.test(cc) || !/immutable/.test(cc)) add("C1", "error", got.url, `a hashed file sent cache-control ${cc || "none"}, not a year immutable`);
    } else {
      if (!got.headers.etag && !got.headers["last-modified"]) add("C2", "error", got.url, "an unhashed file has no ETag or Last-Modified");
      if (/immutable/.test(cc)) add("C2", "warning", got.url, "an unhashed file is immutable: a change in place reaches no returning reader");
      else if (keptTooLong(cc)) add("C2", "error", got.url, `an unhashed file sent cache-control ${cc}: browsers keep it over ${BAR.unhashedMaxAgeS} s without asking, so a deploy reaches returning readers late; hash its name or revalidate`);
    }
    if (/\.(css|js|svg)$/.test(new URL(got.url).pathname) && !/^(zstd|br)$/.test(got.headers["content-encoding"] ?? "")) {
      add("C3", "error", got.url, `sent ${got.headers["content-encoding"] ?? "uncompressed"}, not zstd or Brotli`);
    }
  }

  if (home && !/h3=/.test(home.headers["alt-svc"] ?? "")) add("C4", "error", home.url, "no HTTP/3 (alt-svc h3)");
  for (const [kind, chain] of Object.entries(o.redirects)) {
    const redirects = chain.filter((hop) => hop.status >= 300 && hop.status < 400).length;
    if (redirects > 1) add("C5", "error", chain[0].url, `${kind}: ${redirects} redirects (${chain.map((hop) => `${hop.status} ${hop.url}`).join(" > ")})`);
  }

  if (o.earlyHints === null) add("D1", "warning", `${o.base}/`, "could not read the HTTP/2 response to look for a 103");
  else if (!o.earlyHints.includes(103)) {
    const why = new URL(o.base).host.endsWith(".workers.dev") ? ": workers.dev never sends Early Hints; the site needs its own domain" : "";
    add("D1", "error", `${o.base}/`, `no 103 Early Hints before the page${why}`);
  }

  if (home && isHtml(home) && !runsApp(home.body)) {
    const rules = home.headers["speculation-rules"];
    if (!rules) add("E1", "error", home.url, "a page with no app sends no Speculation-Rules header");
    else if (rules.includes("/cdn-cgi/")) add("E1", "error", home.url, `Cloudflare's generic rules (${rules}), not site-runtime's ./prefetch file`);
  }

  if (o.hits.length) {
    const hit = median(o.hits.map((got) => got.ttfb));
    if (hit > BAR.hitTtfbMs) add("A2", "warning", o.hits[0].url, `a stored page took ${ms(hit)} to the first byte (bar ${ms(BAR.hitTtfbMs)})`);
  }
  if (worker && o.misses.length) {
    const miss = median(o.misses.map((got) => got.ttfb));
    if (miss > BAR.missTtfbErrorMs) add("F2", "error", o.misses[0].url, `an uncached render took ${ms(miss)} to the first byte (bar ${ms(BAR.missTtfbMs)})`);
    else if (miss > BAR.missTtfbMs) add("F2", "warning", o.misses[0].url, `an uncached render took ${ms(miss)} to the first byte (bar ${ms(BAR.missTtfbMs)})`);
  }

  for (const [strategy, result] of Object.entries(o.pagespeed)) {
    const url = `${o.base}/`;
    if (result.error) {
      add("A3", "warning", url, `${strategy}: ${result.error}`);
      continue;
    }
    const lh = result.lighthouseResult;
    const score = lh?.categories?.performance?.score;
    const bar = strategy === "mobile" ? BAR.labPhone : BAR.labDesktop;
    if (typeof score === "number" && score < bar) add("A3", "error", url, `${strategy} Lighthouse performance ${Math.round(score * 100)} (bar ${bar * 100})`);
    for (const [id, item] of Object.entries(AUDITS)) {
      const audit = lh?.audits?.[id];
      if (audit && typeof audit.score === "number" && audit.score < 0.9) add(item, "error", url, `${strategy} Lighthouse ${id}: ${audit.displayValue || audit.title}`);
    }
    const field = result.loadingExperience?.metrics;
    if (!field) {
      add("A1", "warning", url, `${strategy}: no Chrome field data for this page yet`);
      continue;
    }
    const p75 = (key) => field[key]?.percentile;
    const checks = [
      ["LARGEST_CONTENTFUL_PAINT_MS", BAR.lcpMs, "A1", "LCP", (v) => ms(v)],
      ["INTERACTION_TO_NEXT_PAINT", BAR.inpMs, "A1", "INP", (v) => ms(v)],
      ["CUMULATIVE_LAYOUT_SHIFT_SCORE", BAR.cls * 100, "A1", "CLS", (v) => (v / 100).toFixed(2)],
      ["EXPERIMENTAL_TIME_TO_FIRST_BYTE", BAR.fieldTtfbMs, "A2", "TTFB", (v) => ms(v)],
    ];
    for (const [key, bar, item, name, show] of checks) {
      const value = p75(key);
      if (typeof value === "number" && value > bar) add(item, "error", url, `${strategy} field p75 ${name} ${show(value)} (bar ${show(bar)})`);
    }
  }
  return findings;
}
