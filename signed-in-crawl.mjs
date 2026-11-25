import { checkSecurityHeaders } from "./check.mjs";
import { siteForOrigin } from "./sites-values.mjs";
import { errorMessage } from "./log.mjs";

/**
 * @typedef {object} CrawlFinding
 * @property {"error" | "warning"} severity
 * @property {string} check A checklist item (checkSecurityHeaders' id, R4, I3), or "session" / "crawl" when the crawl could not run.
 * @property {string} detail
 */

/**
 * @typedef {object} CrawlResult
 * @property {"pass" | "fail" | "error"} status
 * @property {CrawlFinding[]} findings
 */

/**
 * @typedef {object} CrawlOptions
 * @property {string} origin The app's origin, as its registry entry names it.
 * @property {(request: Request) => Promise<Response>} fetch The app's own fetch: its handler in-process, or the network.
 * @property {Record<string, string>} headers What signs the request in (a session cookie, Access service-token headers). Never reported.
 * @property {string[]} pages Pages, the first being the signed-in home: a redirect, 401 or 403 there makes the result "error".
 * @property {string[]} [json] JSON reads, graded as subresources.
 * @property {string[]} [actions] JSON actions probed for R4 with a text/plain and a form body, each of which must get 415.
 * @property {string} [r4Note] A warning to add for R4 when the app is not probed, saying why.
 */

// THE SIGNED-IN CRAWL. A stranger's live check (bin/site-runtime-security.mjs) sees only the sign-in redirect of an app
// behind a sign-in. An app grades the pages behind it itself, where the credential already lives, and publishes the
// result as a report devkit's scoreboard reads (devkit live/areas.json, the reported check "signed-in-security"; GitHub
// never holds the credential). Capsid's Portal and Carrel's Desk run it.
//
// `crawlApp` asks the app's own fetch (in-process, or over the network) for its pages with whatever headers sign it in,
// grades each response with checkSecurityHeaders against the app's registry entry, and grades the first same-origin
// script a page names and each JSON read. On JSON actions it probes R4: a text/plain and a form body must get 415, so a
// cross-site form never reaches the action as a simple request. Every cross-origin subresource a page names is a
// warning (what COEP or default-src 'none' would have to allow). A page without Cache-Control no-transform is an error:
// Cloudflare would inject the Web Analytics beacon into it. A crawl that never got past the sign-in is "error",
// never a pass. Findings name a URL, a status and an item; never a page body, a cookie or a token.

export const SIGNED_IN_CHECK = "signed-in-security";
export const SIGNED_IN_REPORT_PATH = "/reports/signed-in-security.json";
export const SIGNED_IN_MISSING_PATH = "/signed-in-crawl-404";
const MAX_FINDINGS = 60;

const NAV_HEADERS = {
  Accept: "text/html",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-Dest": "document",
  "User-Agent": "site-runtime-signed-in-crawl",
};
const SUB_HEADERS = {
  Accept: "*/*",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Dest": "empty",
};

/** @param {string} origin @param {string} url @param {Response} response @returns {CrawlFinding[]} */
function gradeResponse(origin, url, response) {
  const site = siteForOrigin(origin)?.id;
  const html = /^\s*text\/html/i.test(response.headers.get("Content-Type") ?? "");
  const results = checkSecurityHeaders(response.headers, { ...(site ? { site } : {}), csp: html });
  if (results.length === 0)
    throw new Error(
      "checkSecurityHeaders returned no results, so a pass would mean nothing was checked",
    );
  return results
    .filter((r) => !r.pass && !r.notice)
    .map((r) => ({
      severity: r.warn ? "warning" : "error",
      check: r.id,
      detail: `${url} (${response.status}) ${r.name}: ${r.detail}`,
    }));
}

/** @param {string} origin @param {string} url @param {string} html @returns {CrawlFinding[]} */
function crossOriginLoads(origin, url, html) {
  const out = new Set();
  for (const m of html.matchAll(
    /<(script|link|img|iframe|source|video|audio|embed)\b[^<>]*?\s(?:src|href)\s*=\s*["']?([^"'\s>]+)/gi,
  )) {
    const tag = (m[1] ?? "").toLowerCase();
    if (tag === "link" && !/\brel\s*=\s*["']?(?:stylesheet|preload|modulepreload|icon)/i.test(m[0]))
      continue;
    let target;
    try {
      target = new URL(m[2] ?? "", url);
    } catch {
      continue;
    }
    if (target.protocol === "data:" || target.origin === origin) continue;
    out.add(`${tag} from ${target.origin}`);
  }
  return [...out].map((load) => ({
    severity: "warning",
    check: "I3",
    detail: `${url} loads a ${load}, which COEP and default-src 'none' must allow`,
  }));
}

/** @param {string} origin @param {string} url @param {string} html */
function firstScript(origin, url, html) {
  for (const m of html.matchAll(/<script\b[^<>]*\ssrc\s*=\s*["']?([^"'\s>]+)/gi)) {
    try {
      const target = new URL(m[1] ?? "", url);
      if (target.origin === origin) return target.pathname;
    } catch {
      // not a URL: skip it
    }
  }
  return null;
}

/** @param {CrawlOptions} opts @returns {Promise<CrawlResult>} */
export async function crawlApp(opts) {
  /** @type {CrawlFinding[]} */
  const findings = [];
  /** @param {string} path @param {Record<string, string>} extra @param {RequestInit} init */
  const get = async (path, extra = {}, init = {}) => {
    const url = new URL(path, opts.origin).href;
    const response = await opts.fetch(
      new Request(url, { redirect: "manual", ...init, headers: { ...opts.headers, ...extra } }),
    );
    return { url, response };
  };
  let script = null;
  for (const path of opts.pages) {
    const { url, response } = await get(path, NAV_HEADERS);
    if (
      path === opts.pages[0] &&
      (response.status >= 300 || response.status === 401 || response.status === 403)
    ) {
      await response.body?.cancel();
      const location = response.headers.get("Location");
      const where = location ? `, to ${new URL(location, url).host}` : "";
      return {
        status: "error",
        findings: [
          {
            severity: "error",
            check: "session",
            detail: `${url} answered ${response.status}${where}: the crawl did not reach the signed-in pages`,
          },
        ],
      };
    }
    findings.push(...gradeResponse(opts.origin, url, response));
    const html = /text\/html/i.test(response.headers.get("Content-Type") ?? "")
      ? await response.text()
      : "";
    // A signed-in page Cloudflare may transform gets the Web Analytics beacon: private pages are never counted.
    if (
      html &&
      !/(?:^|,)\s*no-transform\s*(?:,|$)/i.test(response.headers.get("Cache-Control") ?? "")
    )
      findings.push({
        severity: "error",
        check: "analytics",
        detail: `${url} (${response.status}) has no Cache-Control no-transform, so Web Analytics counts it (./edge-cache PRIVATE_PAGE_HEADERS)`,
      });
    if (!html) await response.body?.cancel();
    findings.push(...crossOriginLoads(opts.origin, url, html));
    script ??= firstScript(opts.origin, url, html);
  }
  for (const path of [...(script ? [script] : []), ...(opts.json ?? [])]) {
    const { url, response } = await get(path, SUB_HEADERS);
    await response.body?.cancel();
    findings.push(...gradeResponse(opts.origin, url, response));
  }
  for (const path of opts.actions ?? []) {
    for (const type of ["text/plain", "application/x-www-form-urlencoded"]) {
      const { url, response } = await get(
        path,
        { ...SUB_HEADERS, "Content-Type": type },
        { method: "POST", body: "r4=probe" },
      );
      await response.body?.cancel();
      if (response.status !== 415)
        findings.push({
          severity: "error",
          check: "R4",
          detail: `${url} answered ${response.status} to a ${type} body; a JSON route refuses it with 415 (requireJson)`,
        });
    }
  }
  if (opts.r4Note) findings.push({ severity: "warning", check: "R4", detail: opts.r4Note });
  const errors = findings.some((f) => f.severity === "error");
  return { status: errors ? "fail" : "pass", findings: findings.slice(0, MAX_FINDINGS) };
}

/** @param {() => Promise<CrawlResult>} run @returns {Promise<CrawlResult>} */
export async function guardedCrawl(run) {
  try {
    return await run();
  } catch (error) {
    return {
      status: "error",
      findings: [
        {
          severity: "error",
          check: "crawl",
          detail: `could not run: ${errorMessage(error)}`.slice(0, 300),
        },
      ],
    };
  }
}

/**
 * @param {Record<string, CrawlResult>} sites
 * @param {{ at: Date, ref: string }} meta
 * @returns {{ check: "signed-in-security", at: string, ref: string, sites: Record<string, CrawlResult> }}
 */
export function signedInReport(sites, meta) {
  return { check: SIGNED_IN_CHECK, at: meta.at.toISOString(), ref: meta.ref.slice(0, 60), sites };
}

/** One line for a log: each host's status and error count. @param {{ sites: Record<string, CrawlResult> }} report */
export function signedInSummary(report) {
  return Object.entries(report.sites)
    .map(
      ([origin, r]) =>
        `${new URL(origin).host} ${r.status} (${r.findings.filter((f) => f.severity === "error").length} errors)`,
    )
    .join(", ");
}

/** The stored report as GET SIGNED_IN_REPORT_PATH serves it, or a 404 before the first run. Public: findings only.
 *  @param {string | null | undefined} body */
export function signedInReportResponse(body) {
  if (!body)
    return new Response("No report yet.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
