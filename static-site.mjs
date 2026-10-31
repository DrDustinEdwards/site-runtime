/**
 * The Worker in front of a static site's assets (Capsomer, Prelum's specimen, Carrel's public page, Enarratio's gallery,
 * the Capsid explorer): one front door, so each gets the same speed and caching headers as the rendered sites.
 *
 * - One hop to the canonical address (`./url` canonicalRedirect: https, no trailing slash), unless `canonical` is false.
 * - Content-Security-Policy reports at `reportPath` (`./csp-report`), limited by the `CSP_REPORT_RATE_LIMIT` binding
 *   when the Worker has one.
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

import { receiveCspReport } from "./csp-report.mjs";
import { UNCACHED } from "./edge-cache.mjs";
import { applyHeaderSet } from "./headers.mjs";
import { SPECULATION_RULES_HEADER, SPECULATION_RULES_PATH, speculationRulesResponse } from "./prefetch.mjs";
import { withPreloadHeader } from "./preload.mjs";
import { serverTiming } from "./server-timing.mjs";
import { canonicalRedirect } from "./url.mjs";

/**
 * @typedef {{
 *   ASSETS: { fetch(request: Request): Promise<Response> },
 *   CSP_REPORT_RATE_LIMIT?: { limit(options: { key: string }): Promise<{ success: boolean }> },
 * }} StaticSiteEnv
 */

/** @param {Response} response @param {Readonly<Record<string, string>>} set */
function withSet(response, set) {
  const headers = new Headers(response.headers);
  applyHeaderSet(headers, set);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * The fetch handler for a static site. `headers` is the site's security set (the one its `_headers` file was written
 * from), `preload` the `Link` header value from `preloads(...).header`.
 * @param {{
 *   headers?: Readonly<Record<string, string>>,
 *   preload?: string,
 *   reportPath?: string | null,
 *   prefetch?: Parameters<typeof speculationRulesResponse>[0] | false,
 *   canonical?: Parameters<typeof canonicalRedirect>[1] | false,
 *   notFound?: string,
 * }} [options]
 */
export function staticSite({ headers = {}, preload = "", reportPath = "/csp-report", prefetch = {}, canonical = {}, notFound = "/404" } = {}) {
  return {
    /** @param {Request} request @param {StaticSiteEnv} env */
    async fetch(request, env) {
      const url = new URL(request.url);
      const redirect = canonical === false ? null : canonicalRedirect(request, canonical);
      if (redirect) return withSet(redirect, headers);
      if (reportPath && url.pathname === reportPath) {
        const limiter = env.CSP_REPORT_RATE_LIMIT;
        // Keyed on the edge-set client address, which is counted and never logged; a refusal drops the report (still 204).
        const allow = limiter
          ? async (/** @type {Request} */ r) => (await limiter.limit({ key: r.headers.get("CF-Connecting-IP") ?? "unknown" })).success
          : undefined;
        return receiveCspReport(request, { headers, allow });
      }
      if (prefetch !== false && url.pathname === SPECULATION_RULES_PATH) return withSet(speculationRulesResponse(prefetch, request), headers);

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
