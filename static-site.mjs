/**
 * The Worker in front of a static site's assets (Capsomer, Prelum's specimen, Carrel's public page, Enarratio's gallery,
 * the Capsid explorer): one front door, so each gets the same speed and caching headers as the rendered sites.
 *
 * - One hop to the canonical address (`./url` canonicalRedirect: https, no trailing slash), unless `canonical` is false.
 * - Content-Security-Policy reports at `reportPath` (`./csp-report`), limited by the `CSP_REPORT_RATE_LIMIT` binding
 *   when the Worker has one.
 * - `/health` (`./health`), unless `health` is false: `healthResponse` with `sha` from the `DEPLOY_SHA` var, which devkit's
 *   shared deploy (worker-deploy.yml, `sha-var: DEPLOY_SHA`) sets, so its live gate can see the deploy is serving.
 * - The prefetch rules at `/speculation-rules.json` (`./prefetch`), unless `prefetch` is false, and the
 *   `Speculation-Rules` header on every page, so Cloudflare's generic rules (Speed Brain) are not the ones used.
 * - On a page: the preload `Link` header, which Early Hints answers with a 103 (`./preload`); `Server-Timing` for the
 *   asset read; charset=utf-8; and any header of `headers` the page's own `_headers` rules left out.
 * - A path with no file gets the site's 404 page (`notFound`, `/404` by default) with status 404 and
 *   `private, no-store`, so no browser or proxy keeps a "not found" after the page exists. A page answered to a request
 *   carrying a cookie is `private, no-store` too, as on the rendered sites (`./edge-cache` forReader).
 *
 * Every other file (scripts, styles, fonts, images) passes through untouched, with its `_headers` rules. In wrangler,
 * `run_worker_first` sends the Worker every page and leaves the hashed files to the asset server, such as
 * `["/*", "!/assets/*"]`; `not_found_handling` may be "none" or "404-page".
 */

import { CSP_REPORT_GROUP, CSP_REPORT_PATH, buildContentSecurityPolicy, buildStagedPolicy, reportingEndpoints } from "./csp.mjs";
import { receiveCspReport } from "./csp-report.mjs";
import { UNCACHED } from "./edge-cache.mjs";
import { applyHeaderSet, buildSecurityHeaders, headersFile } from "./headers.mjs";
import { healthResponse } from "./health.mjs";
import { SPECULATION_RULES_HEADER, SPECULATION_RULES_PATH, speculationRulesResponse } from "./prefetch.mjs";
import { withPreloadHeader } from "./preload.mjs";
import { serverTiming } from "./server-timing.mjs";
import { canonicalRedirect } from "./url.mjs";

/**
 * @typedef {{
 *   ASSETS: { fetch(request: Request): Promise<Response> },
 *   CSP_REPORT_RATE_LIMIT?: { limit(options: { key: string }): Promise<{ success: boolean }> },
 *   DEPLOY_SHA?: string,
 * }} StaticSiteEnv
 */

/** The opt-ins that are the page policy's options too (buildContentSecurityPolicy). */
const POLICY_OPT_INS = /** @type {const} */ (["cloudflareWebAnalytics", "inlineScripts", "strictDynamic", "framedBySameOrigin", "baseUriSelf", "formTargets"]);

/**
 * A site's headers from its registry entry (./sites), for its static files and the Worker in front of them: `set`, what
 * every response carries (buildSecurityHeaders({ site }), then `headers`, what the site adds on top, such as Prelum's
 * TDMRep header), and `file`, the `_headers` text (headersFile with charset: true, then the entry's `assets.paths`). A
 * static site whose entry has `assets.policy` serves every page under that one policy, built with its policy opt-ins
 * (denyUnlisted true, cloudflareWebAnalytics, framedBySameOrigin...) and reporting to /csp-report on its own origin or
 * `assets.reportOrigin`: it is in `set` with its Reporting-Endpoints, and in `file` as a `/*` rule of its own, since
 * headersFile keeps a policy off the set's block. What the entry stages ("report-only" trustedTypes or denyUnlisted)
 * goes in a Report-Only policy beside it (buildStagedPolicy). The site-runtime-headers bin writes `file`.
 * @param {import("./sites.mjs").SiteEntry} entry
 * @param {{ headers?: Readonly<Record<string, string>> }} [options]
 * @returns {{ set: Record<string, string>, file: string }}
 */
export function staticHeaders(entry, { headers = {} } = {}) {
  const { policy, reportOrigin = entry.origin, paths = {} } = entry.assets ?? {};
  /** @type {Record<string, string>} */
  const set = { ...buildSecurityHeaders({ site: entry }), ...headers };
  /** @type {Record<string, Record<string, string>>} */
  const rules = {};
  if (policy) {
    const optIns = Object.fromEntries(POLICY_OPT_INS.flatMap((key) => (entry.optIns?.[key] ? [[key, entry.optIns[key].value]] : [])));
    const remote = new URL(reportOrigin).origin !== entry.origin;
    const types = entry.optIns?.trustedTypes?.value;
    const unlisted = entry.optIns?.denyUnlisted?.value;
    /** @type {import("./csp.mjs").SitePolicy} */
    const options = {
      ...optIns,
      denyUnlisted: unlisted === true,
      ...(types === true ? { trustedTypes: true } : {}),
      ...policy,
      reportUri: remote ? new URL(CSP_REPORT_PATH, reportOrigin).href : CSP_REPORT_PATH,
    };
    const csp = buildContentSecurityPolicy(options);
    set[csp.name] = csp.value;
    rules["/*"] = { [csp.name]: csp.value };
    // What the entry stages (a "report-only" trustedTypes or denyUnlisted) rides in the Report-Only policy beside it.
    const staged = { ...(types === "report-only" ? { trustedTypes: /** @type {const} */ (true) } : {}), ...(unlisted === "report-only" ? { denyUnlisted: true } : {}) };
    if (Object.keys(staged).length > 0) {
      const companion = buildStagedPolicy(options, staged);
      set[companion.name] = companion.value;
      rules["/*"][companion.name] = companion.value;
    }
    set["Reporting-Endpoints"] = reportingEndpoints(CSP_REPORT_GROUP, new URL(CSP_REPORT_PATH, reportOrigin));
  }
  for (const [pattern, added] of Object.entries(paths)) rules[pattern] = { ...rules[pattern], ...added };
  const file = headersFile(set, {
    charset: true,
    comment: `Written by site-runtime-headers from the site registry (@dustinedwards/site-runtime/sites, ${entry.id}). Do not edit.`,
    paths: rules,
  });
  return { set, file };
}

/**
 * The fetch handler for a static site. `site` is its registry entry, whose set (staticHeaders) its `_headers` file was
 * written from, with `headers` added to it; without `site`, `headers` is the whole set. `preload` is the `Link` header
 * value from `preloads(...).header`.
 * @param {{
 *   site?: import("./sites.mjs").SiteEntry,
 *   headers?: Readonly<Record<string, string>>,
 *   preload?: string,
 *   reportPath?: string | null,
 *   prefetch?: Parameters<typeof speculationRulesResponse>[0] | false,
 *   canonical?: Parameters<typeof canonicalRedirect>[1] | false,
 *   notFound?: string,
 *   health?: string | false,
 * }} [options]
 */
export function staticSite({ site, headers: extra = {}, preload = "", reportPath = CSP_REPORT_PATH, prefetch = {}, canonical = {}, notFound = "/404", health = "/health" } = {}) {
  const headers = site ? staticHeaders(site, { headers: extra }).set : extra;
  return {
    /** @param {Request} request @param {StaticSiteEnv} env */
    async fetch(request, env) {
      const url = new URL(request.url);
      const redirect = canonical === false ? null : canonicalRedirect(request, canonical);
      if (redirect) return applyHeaderSet(redirect, headers);
      if (reportPath && url.pathname === reportPath) {
        const limiter = env.CSP_REPORT_RATE_LIMIT;
        // Keyed on the edge-set client address, which is counted and never logged; a refusal drops the report (still 204).
        const allow = limiter
          ? async (/** @type {Request} */ r) => (await limiter.limit({ key: r.headers.get("CF-Connecting-IP") ?? "unknown" })).success
          : undefined;
        return receiveCspReport(request, { headers, allow });
      }
      if (health !== false && url.pathname === health) return applyHeaderSet(await healthResponse({ sha: env.DEPLOY_SHA }), headers);
      if (prefetch !== false && url.pathname === SPECULATION_RULES_PATH) return applyHeaderSet(speculationRulesResponse(prefetch, request), headers);

      const start = performance.now();
      let response = await env.ASSETS.fetch(request);
      const missing = (request.method === "GET" || request.method === "HEAD") && response.status === 404;
      if (missing) {
        // The 404 page through the asset server, so its own `_headers` rules (its policy) come with it.
        const page = await env.ASSETS.fetch(new Request(new URL(notFound, url)));
        if (page.ok) {
          response.body?.cancel();
          response = new Response(request.method === "HEAD" ? null : page.body, { status: 404, headers: page.headers });
        }
      }
      const ms = performance.now() - start;
      if (!(response.headers.get("Content-Type") ?? "").startsWith("text/html")) return response;

      const out = new Headers(response.headers);
      applyHeaderSet(out, headers, { overwrite: false });
      if (prefetch !== false) out.set(SPECULATION_RULES_HEADER.name, SPECULATION_RULES_HEADER.value);
      out.append("Server-Timing", serverTiming([{ name: "asset", ms }]));
      if (response.status >= 400 || request.headers.has("Cookie")) out.set("Cache-Control", UNCACHED);
      const page = new Response(response.body, { status: response.status, statusText: response.statusText, headers: out });
      return response.status === 200 ? withPreloadHeader(page, preload) : page;
    },
  };
}
