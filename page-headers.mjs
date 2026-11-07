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
 * - A route's own header wins: the set goes on with `overwrite: false`, and the policy only when the route sent neither
 *   Content-Security-Policy nor its Report-Only form (a preview or print route that chose its own on purpose).
 * - Cross-Origin-Resource-Policy follows the type when `corp` is on (corpFor): images, fonts and feeds other sites embed
 *   are cross-origin, pages and JSON same-origin.
 * - Reporting-Endpoints names the report sink at the request's own origin, and is left off where a browser would ignore
 *   it anyway (plain http off loopback; reportingEndpoints refuses it).
 * - `renew` (a site that stores pages at the edge): an HTML response whose policy carries a nonce is a stored page, so it
 *   gets a fresh one per reader (renewNonce) and its policy is built again for it, instead of the stored one standing.
 * - `env` (the fourth argument of withSecurityHeaders) is handed to `policy` and `reportOrigin`, for a site whose policy
 *   depends on per-request bindings (image origins from config) and not on module scope.
 * - `reportOrigin(context)` names a report sink on another origin (the AI door's, outside Access); the policy's
 *   report-uri and Reporting-Endpoints then point there instead of at the request's own origin.
 * - A route may be framed by its own site (X-Frame-Options SAMEORIGIN, a preview); any other value a route sets
 *   there is replaced with the set's, so a route can never loosen framing further than that.
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
  reportOrigin,
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
   * @param {unknown} [env] the request's bindings, for a policy or report origin that depends on them
   */
  function withSecurityHeaders(response, request, given, env) {
    const url = new URL(request.url);
    const origin = reportOrigin?.({ request, url, env });
    const sink = origin ? new URL(reportPath, origin) : new URL(reportPath, url);
    const reportUri = origin ? sink.href : reportPath;
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
      const site = {
        reportUri,
        reportTo: group,
        ...policy({ nonce, request, url, staged: false, env }),
      };
      extra["Content-Security-Policy"] = buildContentSecurityPolicy(site).value;
      if (staged) {
        const beside = {
          reportUri,
          reportTo: group,
          ...policy({ nonce, request, url, staged: true, env }),
        };
        const companion = buildStagedPolicy(beside, staged);
        extra[companion.name] = companion.value;
      }
    }
    if (sink.protocol === "https:" || LOOPBACK.test(sink.hostname))
      extra["Reporting-Endpoints"] = reportingEndpoints(group, sink);
    const framing = response.headers.get("X-Frame-Options")?.trim().toUpperCase();
    if (framing && framing !== "SAMEORIGIN" && framing !== "DENY" && set["X-Frame-Options"])
      extra["X-Frame-Options"] = set["X-Frame-Options"];
    if (corp) extra["Cross-Origin-Resource-Policy"] = corpFor(response.headers.get("Content-Type"));
    if (noindex?.(url.pathname)) extra["X-Robots-Tag"] = "noindex";
    // The policy replaces a stored page's; every other header a route set keeps its value.
    const target =
      stored || extra["X-Frame-Options"]
        ? applyHeaderSet(response, stored ? extra : { "X-Frame-Options": extra["X-Frame-Options"] })
        : response;
    return applyHeaderSet(target, { ...set, ...(stored ? {} : extra) }, { overwrite: false });
  }

  return { withSecurityHeaders, nonceFor };
}
