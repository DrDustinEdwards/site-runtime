/**
 * A site's operator API: the one door Capsid reaches a site's operations through (Capsid's src/site-operator.ts).
 * `POST {tool, args}` with `Authorization: Bearer <token>` runs one of the site's named tools; `GET` with the same bearer
 * lists them. Every site that serves one serves it through this, so the boundary is one implementation:
 *
 * - The bearer is the whole boundary. The token is the site's secret, compared in constant time (./compare) and never
 *   echoed or logged. Unset or shorter than MIN_TOKEN_LENGTH closes the route (503), so a deployment that forgot the
 *   secret is never open.
 * - Authentication comes before the rate limit, so an anonymous flood never spends the operator's allowance. A failed
 *   bearer logs OWASP's authn_login_fail; a spent limit logs excess_rate_limit_exceeded. The limit refuses when its
 *   counter is unavailable.
 * - The body is read to a ceiling (./body). An unknown tool is a 400 that names the tools there are.
 * - A tool answers its data, sent back as `{ok: true, data}`. A tool that throws is a 500 with its message, logged.
 * - Every answer is JSON, `no-store` and `noindex`.
 *
 * The site decides what its tools are and what each does; this owns only the door.
 */
import { readCapped } from "./body.mjs";
import { safeEqual } from "./compare.mjs";
import { OWASP_EVENTS, logEvent, requestFields } from "./log.mjs";
import { limit, limitedResponse, mustStop } from "./rate-limit/limit.mjs";

/** The shortest token the route accepts: 32 characters. */
export const MIN_TOKEN_LENGTH = 32;
/** The body ceiling: a tool name and small arguments. */
export const OPERATOR_BODY_MAX = 4 * 1024;
/** The default limit: 30 calls a minute across every caller holding the token. */
export const OPERATOR_RULES = [{ limit: 30, windowSeconds: 60 }];

/**
 * @param {unknown} body
 * @param {number} [status]
 * @param {Record<string, string>} [headers]
 */
function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      ...headers,
    },
  });
}

/**
 * @param {Request} request
 * @param {string | undefined} configured
 * @returns {Promise<Response | null>}
 */
async function bearerRefusal(request, configured) {
  if (!configured || configured.length < MIN_TOKEN_LENGTH) {
    return json({ ok: false, error: "The operator API is not configured on this deployment." }, 503);
  }
  const presented = /^Bearer\s+(.+)$/i.exec((request.headers.get("authorization") ?? "").trim())?.[1] ?? "";
  // Refused on length before the hash, which an anonymous caller could otherwise ask for in any size.
  if (presented.length > configured.length * 2 || !(await safeEqual(presented, configured))) {
    logEvent(OWASP_EVENTS.signInFailure, { ...requestFields(request), via: "operator-bearer" }, { level: "warn" });
    return json({ ok: false, error: "Invalid or missing bearer token." }, 401);
  }
  return null;
}

/**
 * The operator API's answer to one request.
 *
 * @param {Request} request
 * @param {import("./operator.d.mts").OperatorOptions} options
 * @returns {Promise<Response>}
 */
export async function operatorResponse(request, options) {
  const { tools } = options;
  const names = Object.keys(tools);
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ ok: false, error: "Use GET or POST." }, 405, { allow: "GET, POST" });
  }
  const refused = await bearerRefusal(request, options.token);
  if (refused) return refused;
  if (request.method === "GET") {
    return json({ ok: true, data: { tools: names.map((name) => ({ name, description: tools[name]?.description ?? "" })) } });
  }

  const verdict = await limit(options.limiter, options.limitKey ?? "operator", options.rules ?? OPERATOR_RULES, { onUnavailable: "refuse" });
  if (mustStop(verdict, "refuse")) {
    logEvent(OWASP_EVENTS.rateLimitExceeded, { ...requestFields(request, { status: 429 }), via: "operator" }, { level: "warn" });
    return limitedResponse(verdict);
  }

  /** @type {unknown} */
  let body = null;
  try {
    const text = await readCapped(request, OPERATOR_BODY_MAX);
    if (text === null) return json({ ok: false, error: `The body is over ${OPERATOR_BODY_MAX} bytes.` }, 413);
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const { tool, args } = /** @type {{ tool?: unknown, args?: unknown }} */ (body && typeof body === "object" ? body : {});
  if (typeof tool !== "string" || !Object.hasOwn(tools, tool)) {
    return json({ ok: false, error: `Unknown tool. Available: ${names.join(", ")}.` }, 400);
  }
  const plainArgs = args && typeof args === "object" && !Array.isArray(args) ? /** @type {Record<string, unknown>} */ (args) : {};
  try {
    const data = await /** @type {import("./operator.d.mts").OperatorTool} */ (tools[tool]).run(plainArgs);
    return json({ ok: true, data: data ?? null });
  } catch (error) {
    logEvent("operator_tool_failed", { ...requestFields(request), tool, error }, { level: "error" });
    return json({ ok: false, error: error instanceof Error ? error.message : "The tool failed." }, 500);
  }
}
