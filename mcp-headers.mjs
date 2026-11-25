/** The MCP door's era router and response headers (see mcp-server.mjs). */

import {
  CSP_REPORT_GROUP,
  CSP_REPORT_PATH,
  buildPolicy,
  reportingEndpoints,
  scriptHash,
} from "./csp.mjs";
import { receiveCspReport } from "./csp-report.mjs";
import { applyHeaderSet, buildSecurityHeaders } from "./headers.mjs";
import { CONSENT_STYLE } from "./mcp-login.mjs";
import { OWNER_STYLE } from "./owner-page.mjs";
import { securityTxtResponse } from "./security-txt.mjs";

// THE ERA ROUTER, and the prior-era shim. MCP 2026-07-28 removed the `initialize` handshake, sessions and the GET
// stream. The primary handler is `legacy: "reject"` (modern-only); the clients these servers serve still open legacy, so
// prior-era traffic is diverted in front of it, as the library documents on `isLegacyRequest`.
//
// REMOVAL CONDITION. Stop passing `isLegacyRequest` when dustinedwards-info's probe (`mcp/scripts/probe-report.mjs`)
// shows the target clients opening with `server/discover` instead of `initialize`. Delete on a capture, never on a release note.

/**
 * Answers one MCP request in the era that can. A request `isLegacyRequest` calls legacy goes to a `legacy: "stateless"`
 * handler; everything else, malformed envelopes included, to the `legacy: "reject"` handler, which owns those error
 * answers. The predicate reads the body, so it is given a clone.
 *
 * @template F
 * @template {object} O
 * @template E
 * @template C
 * @param {Request} request
 * @param {E} env
 * @param {C} ctx
 * @param {{ factory: F, options: O, createMcpHandler: (factory: F, options: O & { legacy: "stateless" | "reject" }) => (request: Request, env: E, ctx: C) => Promise<Response>, isLegacyRequest?: (request: Request) => Promise<boolean> | boolean }} sdk
 * @returns {Promise<Response>}
 */
export async function routeMcpEra(
  request,
  env,
  ctx,
  { factory, options, createMcpHandler, isLegacyRequest },
) {
  const legacy =
    isLegacyRequest && (await isLegacyRequest(request.clone())) ? "stateless" : "reject";
  return createMcpHandler(factory, { ...options, legacy })(request, env, ctx);
}

// THE DOOR'S HEADERS. Every response an MCP Worker sends, its 404s and the OAuth library's redirects included, leaves
// through one wrapper: the site's registry entry, never cached or indexed, and a policy that lets no page frame the
// door. The consent page is its only page: one inline <style>, trusted by hash, and no form-action, because approving
// posts into a redirect chain that ends at whatever redirect_uri the client named, and a browser checks form-action on
// every hop. The wrapper also answers
// security.txt and the policy's report sink.

const REPORT_GROUP = CSP_REPORT_GROUP;
/** The consent and owner styles' hashes as a style-src list. @type {Promise<string> | undefined} */
let consentHash;

/**
 * The door's fetch handler: `handler` with every response wearing the set. GET /.well-known/security.txt is answered
 * from `securityTxt` (RFC 9116) and `reportPath` (default /csp-report) by the CSP receiver, with `allowReport` as its
 * rate limiter. A WebSocket upgrade (101) passes as it is; every other response is rebuilt, since a library's headers
 * may be immutable.
 *
 * @template Env
 * @param {(request: Request, env: Env, ctx: unknown) => Response | Promise<Response>} handler
 * @param {{
 *   site: import("./sites.mjs").ServedSiteEntry,
 *   securityTxt: { contact: string, expires: Date | string, policy?: string },
 *   reportPath?: string,
 *   allowReport?: (request: Request, env: Env) => boolean | Promise<boolean>,
 * }} options `site`: the door's registry entry, whose declared deviations (a popup sign-in's COOP) the set keeps
 * @returns {(request: Request, env: Env, ctx: unknown) => Promise<Response>}
 */
export function withMcpHeaders(
  handler,
  { site, securityTxt, reportPath = CSP_REPORT_PATH, allowReport },
) {
  const set = { ...buildSecurityHeaders({ site }), "X-Robots-Tag": "noindex, nofollow" };
  const sinks = [`report-uri ${reportPath}`, `report-to ${REPORT_GROUP}`];
  const types = "require-trusted-types-for 'script'";
  const nonHtml = buildPolicy([
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    types,
    ...sinks,
  ]);
  return async (request, env, ctx) => {
    const url = new URL(request.url);
    const response =
      url.pathname === "/.well-known/security.txt" &&
      (request.method === "GET" || request.method === "HEAD")
        ? securityTxtResponse({ origin: url.origin, ...securityTxt })
        : url.pathname === reportPath
          ? await receiveCspReport(
              request,
              allowReport ? { allow: (r) => allowReport(r, env) } : {},
            )
          : await handler(request, env, ctx);
    const out = applyHeaderSet(response, set);
    if (out === response) return response;
    const { headers } = out;
    if (!/(^|,)\s*no-store\s*(,|$)/i.test(headers.get("Cache-Control") ?? ""))
      headers.set("Cache-Control", "no-store");
    if (/^\s*text\/html/i.test(headers.get("Content-Type") ?? "")) {
      consentHash ??= Promise.all([scriptHash(CONSENT_STYLE), scriptHash(OWNER_STYLE)]).then(
        (hashes) => hashes.map((hash) => `'${hash}'`).join(" "),
      );
      headers.set(
        "Content-Security-Policy",
        buildPolicy([
          "default-src 'none'",
          `style-src ${await consentHash}`,
          "base-uri 'none'",
          "frame-ancestors 'none'",
          types,
          ...sinks,
        ]),
      );
    } else {
      headers.set("Content-Security-Policy", nonHtml);
    }
    headers.set(
      "Reporting-Endpoints",
      reportingEndpoints(REPORT_GROUP, new URL(reportPath, url.origin)),
    );
    return out;
  };
}
