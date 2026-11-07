/**
 * The Worker glue every site's security headers shared, once: the standard set, the page's Content-Security-Policy and
 * its Report-Only companion, the Reporting API endpoint and, where asked, the nonce a request was rendered with and the
 * fresh one an edge-cached page gets. Five sites carried their own 100-line copy of it.
 *
 * `pageSecurity` is called once at module scope with what is the site's: its header set (buildSecurityHeaders), the
 * policy it builds for a request, and what it stages. It answers `withSecurityHeaders(response, request, nonce?)`, which
 * a Worker applies to every response it sends, redirects and errors included, and `nonceFor(request)`, which issues the
 * request's nonce (once, on first ask) for the render to put on its scripts.
 *
 * - A site whose answers load nothing (a JSON door) returns its policy as a string: it goes on verbatim, with no
 *   Report-Only companion, because the builder always names script, style and image sources.
 * - A route's own header wins: the set goes on with `overwrite: false`, and the policy only when the route sent neither
 *   Content-Security-Policy nor its Report-Only form (a preview or print route that chose its own on purpose).
 * - Cross-Origin-Resource-Policy follows the type when `corp` is on (corpFor): images, fonts and feeds other sites embed
 *   are cross-origin, pages and JSON same-origin.
 * - Reporting-Endpoints names the report sink at the request's own origin, and is left off where a browser would ignore
 *   it anyway (plain http off loopback; reportingEndpoints refuses it).
 * - `renew` (a site that stores pages at the edge): an HTML response whose policy carries a nonce is a stored page, so it
 *   gets a fresh one per reader (renewNonce) and its policy is built again for it, instead of the stored one standing.
 * - A WebSocket upgrade (101) goes through untouched (applyHeaderSet).
 */

import {
  CSP_REPORT_GROUP,
  CSP_REPORT_PATH,
  buildContentSecurityPolicy,
  buildStagedPolicy,
  generateNonce,
  renewNonce,
  reportingEndpoints,
} from "./csp.mjs";
import { applyHeaderSet, corpFor } from "./headers.mjs";

const NONCE_IN_POLICY = /'nonce-([A-Za-z0-9+/_=-]+)'/;
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/;

/** @param {Headers} headers */
const isHtml = (headers) => (headers.get("Content-Type") ?? "").toLowerCase().includes("text/html");

/**
 * @param {import("./page-headers.d.mts").PageSecurityOptions} options
 * @returns {import("./page-headers.d.mts").PageSecurity}
 */
export function pageSecurity({
  set,
  policy,
  staged,
  reportPath = CSP_REPORT_PATH,
  group = CSP_REPORT_GROUP,
  corp = false,
  renew = false,
  noindex,
}) {
  if (staged === undefined)
    throw new Error(
      "pageSecurity: say what the site stages ({ trustedTypes, denyUnlisted }) or false for nothing",
    );
  /** @type {WeakMap<Request, string>} */
  const issued = new WeakMap();

  /** @param {Request} request */
  function nonceFor(request) {
    let nonce = issued.get(request);
    if (!nonce) {
      nonce = generateNonce();
      issued.set(request, nonce);
    }
    return nonce;
  }

  /**
   * @param {Response} response
   * @param {Request} request
   * @param {string} [given] the nonce the page was rendered with, when the caller kept it itself
   */
  function withSecurityHeaders(response, request, given) {
    const url = new URL(request.url);
    let nonce = given ?? issued.get(request);
    const rendered = NONCE_IN_POLICY.exec(
      response.headers.get("Content-Security-Policy") ?? "",
    )?.[1];
    const stored = renew && rendered !== undefined && isHtml(response.headers);
    if (stored) {
      nonce = given ?? generateNonce();
      issued.set(request, nonce);
      response = renewNonce(response, nonce);
    }
    if (!isHtml(response.headers) && !stored) nonce = given;
    const own =
      !stored &&
      (response.headers.has("Content-Security-Policy") ||
        response.headers.has("Content-Security-Policy-Report-Only"));
    /** @type {Record<string, string>} */
    const extra = {};
    if (!own) {
      const site = policy({ nonce, request, url, staged: false });
      if (typeof site === "string") {
        extra["Content-Security-Policy"] = site;
      } else {
        extra["Content-Security-Policy"] = buildContentSecurityPolicy({
          reportUri: reportPath,
          reportTo: group,
          ...site,
        }).value;
        const next = staged ? policy({ nonce, request, url, staged: true }) : undefined;
        if (staged && next && typeof next !== "string") {
          const companion = buildStagedPolicy(
            { reportUri: reportPath, reportTo: group, ...next },
            staged,
          );
          extra[companion.name] = companion.value;
        }
      }
    }
    if (url.protocol === "https:" || LOOPBACK.test(url.hostname))
      extra["Reporting-Endpoints"] = reportingEndpoints(group, new URL(reportPath, url));
    if (corp) extra["Cross-Origin-Resource-Policy"] = corpFor(response.headers.get("Content-Type"));
    if (noindex?.(url.pathname)) extra["X-Robots-Tag"] = "noindex";
    // The policy replaces a stored page's; every other header a route set keeps its value.
    const target = stored ? applyHeaderSet(response, extra) : response;
    return applyHeaderSet(target, { ...set, ...(stored ? {} : extra) }, { overwrite: false });
  }

  return { withSecurityHeaders, nonceFor };
}
