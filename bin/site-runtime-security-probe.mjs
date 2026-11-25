/** The requests and the reporting of the live security check: one site's responses, graded and printed as annotation lines. */

import { checkSecurityHeaders, declined } from "../check.mjs";
import { timedFetch } from "../http.mjs";

export const UA = "Mozilla/5.0 (site-runtime-security)";

/**
 * @param {{ served: string, entry: import("../sites.mjs").ServedSiteEntry | undefined }} site `served` is where the site answers now
 */
export function createProbe({ served, entry }) {
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
    report(
      deviation.family ? "notice" : "warning",
      id,
      url,
      `${detail}; declared deviation: ${deviation.reason}`,
    );
  }
  /** Prints the failed results. @param {string} url @param {number} status @param {import("../check.mjs").CheckResult[]} results */
  function print(url, status, results) {
    for (const r of results)
      if (!r.pass)
        report(
          r.notice ? "notice" : r.warn ? "warning" : "error",
          r.id,
          url,
          `(${status}) ${r.name}: ${r.detail}`,
        );
  }
  /** @param {string} path @param {string} [method] */
  async function get(path, method = "GET") {
    const url = new URL(path, served).href;
    const res = await timedFetch(url, {
      method,
      redirect: "manual",
      headers: { "user-agent": UA },
    });
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
    const host =
      location && res.status >= 300 && res.status < 400 ? new URL(location, url).hostname : "";
    if (host.endsWith(".cloudflareaccess.com")) {
      if (!behindAccess)
        report(
          "warning",
          "A1",
          url,
          `is behind Cloudflare Access (${host}): the pages behind it were not graded`,
        );
      behindAccess = true;
      return true;
    }
    const own =
      res.status >= 400 &&
      res.status < 500 &&
      (/^\s*Cloudflare-Access\b/i.test(res.headers.get("WWW-Authenticate") ?? "") ||
        (behindAccess &&
          /\bpre-check=0\b/.test(res.headers.get("Cache-Control") ?? "") &&
          /\b1970\b/.test(res.headers.get("Expires") ?? "") &&
          !res.headers.has("X-Content-Type-Options")));
    return own;
  }

  /**
   * Grades one response with the site's entry; the policy only when it is a page.
   * @param {string} url @param {Response} res @param {{ upload?: boolean, only?: string }} [how] `only`: report that item alone
   */
  function grade(url, res, { upload = false, only } = {}) {
    if (accessGate(url, res)) return;
    const csp = !upload && !only && /^\s*text\/html/i.test(res.headers.get("Content-Type") ?? "");
    const results = checkSecurityHeaders(res.headers, {
      ...(entry ? { site: entry.id } : {}),
      csp,
      upload,
    });
    print(url, res.status, only ? results.filter((r) => r.id === only) : results);
  }

  /** A path's response, graded, or null after reporting why it could not be fetched. @param {string} path @param {string} [method] @param {{ upload?: boolean, only?: string }} [how] */
  async function sample(path, method, how) {
    try {
      const got = await get(path, method);
      grade(got.url, got.res, how);
      return got;
    } catch (error) {
      report(
        "error",
        "A1",
        new URL(path, served).href,
        `could not be fetched: ${error instanceof Error ? error.message : error}`,
      );
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
      if (statuses.includes(res.status) === not && !accessGate(url, res))
        report("error", id, url, `${method ? `${method} ` : ""}answers ${res.status}; ${why}`);
    } catch (error) {
      report(
        "error",
        id,
        new URL(path, served).href,
        `could not be fetched: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
  return {
    report,
    fail,
    print,
    get,
    accessGate,
    grade,
    sample,
    expectStatus,
    counts: () => ({ errors, warnings }),
  };
}
