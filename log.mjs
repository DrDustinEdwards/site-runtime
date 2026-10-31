/**
 * One structured log line per event, and the scrubbers that keep a person's data out of it. A line is one JSON object
 * with an `event` key first (`{"event":"share_card_failed","error":"..."}`), so Workers Logs and a tail can filter on
 * the event's name.
 *
 * What is cut, before the line is written, from every string field (the same scrubbers Foxhound's Sentry options
 * used, moved here so a site's logs and its error reports cut the same things):
 * - email addresses, to `[email]`;
 * - a URL's query string and fragment, in free text and in a field whose name holds `url` or `path` (a query can carry a
 *   magic-link token, a reset code or an unsubscribe token);
 * - Stripe secret, restricted and webhook-signing keys, to `[key]`;
 * - the bound parameters of a failed Drizzle query (`params: ...`, which can hold a whole Stripe event);
 * - with `tokenPath`, the last segment of a site's own token routes (Foxhound's `/u/<token>`), to `/<route>/[token]`.
 * Fields whose name holds `header`, `cookie`, `query` or `arguments` are dropped whole.
 *
 * Never put a token, a code or a secret in a field on purpose; the scrubbers are the net, not the rule.
 */

/** An email address inside any text. */
export const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Stripe secret, restricted and webhook-signing keys. */
export const STRIPE_KEY_PATTERN = /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]+|\bwhsec_[A-Za-z0-9]+/g;
// DrizzleQueryError's message is "Failed query: <sql>\nparams: <values>".
const DRIZZLE_PARAMS = /\nparams: [\s\S]*$/;
// The query string or fragment of a full URL inside free text.
const TEXT_URL_QUERY = /(https?:\/\/[^\s?#'"]*)[?#][^\s'"]*/g;
// The query string or fragment of a field that holds only a URL or path.
const URL_QUERY = /[?#]\S*/g;
/** Field names dropped whole: request headers, cookies, query strings and raw console arguments. */
export const DROPPED_FIELD = /query|header|cookie|arguments/i;

/**
 * @typedef {{ tokenPath?: RegExp }} ScrubOptions
 *   `tokenPath`: a global pattern for the site's token routes with the route in its first group, such as
 *   `/\/(u|p|invite)\/[^/?#\s'"]+/g`; each match becomes `/<group 1>/[token]`.
 */

/**
 * `text` with emails, URL queries, Stripe keys, Drizzle parameters and (with `tokenPath`) route tokens cut out.
 * @param {string} text
 * @param {ScrubOptions} [options]
 * @returns {string}
 */
export function scrubText(text, { tokenPath } = {}) {
  const cut = String(text)
    .replace(DRIZZLE_PARAMS, "\nparams: [redacted]")
    .replace(TEXT_URL_QUERY, "$1")
    .replace(STRIPE_KEY_PATTERN, "[key]")
    .replace(EMAIL_PATTERN, "[email]");
  return tokenPath ? cut.replace(tokenPath, "/$1/[token]") : cut;
}

/**
 * A field that holds only a URL or a path: its query and fragment dropped, then scrubbed as text.
 * @param {string} url
 * @param {ScrubOptions} [options]
 * @returns {string}
 */
export function scrubUrl(url, options) {
  return scrubText(String(url).replace(URL_QUERY, ""), options);
}

/**
 * A copy of `fields` with every string scrubbed (as a URL when the key names a url or path), nested objects and arrays
 * walked, Errors turned into their name and message, and the DROPPED_FIELD keys left out.
 * @param {Record<string, unknown>} fields
 * @param {ScrubOptions} [options]
 * @returns {Record<string, unknown>}
 */
export function scrubFields(fields, options) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (DROPPED_FIELD.test(key)) continue;
    out[key] = scrubValue(key, value, options, 0);
  }
  return out;
}

/**
 * @param {string} key
 * @param {unknown} value
 * @param {ScrubOptions | undefined} options
 * @param {number} depth
 * @returns {unknown}
 */
function scrubValue(key, value, options, depth) {
  if (typeof value === "string") return /url|path/i.test(key) ? scrubUrl(value, options) : scrubText(value, options);
  if (value instanceof Error) return scrubText(`${value.name}: ${value.message}`, options);
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => scrubValue(key, item, options, depth + 1));
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (!DROPPED_FIELD.test(k)) out[k] = scrubValue(k, v, options, depth + 1);
  }
  return out;
}

/**
 * Writes one JSON line, `{ event, ...fields }` scrubbed, to the console: `console.error` for `level: "error"`,
 * `console.warn` for "warn", else `console.log`. A field named `event` cannot replace the event's name.
 * @param {string} event
 * @param {Record<string, unknown>} [fields]
 * @param {ScrubOptions & { level?: "log" | "warn" | "error" }} [options]
 */
export function logEvent(event, fields = {}, { level = "log", ...scrub } = {}) {
  const { event: _ignored, ...rest } = fields;
  const line = JSON.stringify({ event, ...scrubFields(rest, scrub) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/**
 * The fields that tie a log line to its request, for a site to spread into its lines: `request_id` (the `cf-ray`
 * header, empty when there is none), `method`, `path` (scrubbed, never the query) and, when given, the response's
 * `status` and the deployed `sha`.
 * @param {Request} request
 * @param {{ sha?: string, status?: number } & ScrubOptions} [options]
 * @returns {{ request_id: string, method: string, path: string, status?: number, sha?: string }}
 */
export function requestFields(request, { sha, status, ...scrub } = {}) {
  return {
    request_id: request.headers.get("cf-ray") ?? "",
    method: request.method,
    path: scrubUrl(new URL(request.url).pathname, scrub),
    ...(status === undefined ? {} : { status }),
    ...(sha ? { sha } : {}),
  };
}

/**
 * Wraps a Worker's fetch handler so each request writes one `request` line: requestFields with the status, the route
 * (`route(request)` when given, such as the matched pattern, so `/posts/:slug` groups its hits), the ms taken and the
 * sha. A 5xx or a throw is logged at error (a throw as status 500, then rethrown), a 4xx at warn, the rest at log.
 * `sha` is a string or a function of the handler's arguments after the request (`(env) => env.DEPLOY_SHA`).
 * A 400 or 422 (input the site refused) also writes one `input_validation_fail` line (OWASP_EVENTS) with the same
 * request fields and route, unless `inputValidation` is false.
 * @template {unknown[]} A
 * @param {(request: Request, ...rest: A) => Response | Promise<Response>} handler
 * @param {{ sha?: string | ((...rest: A) => string | undefined), route?: (request: Request) => string | undefined, inputValidation?: boolean } & ScrubOptions} [options]
 * @returns {(request: Request, ...rest: A) => Promise<Response>}
 */
export function withRequestLog(handler, { sha, route, inputValidation = true, ...scrub } = {}) {
  return async (request, ...rest) => {
    const started = Date.now();
    let status = 500;
    try {
      const response = await handler(request, ...rest);
      status = response.status;
      return response;
    } finally {
      const named = route?.(request);
      const fields = {
        ...requestFields(request, { sha: typeof sha === "function" ? sha(...rest) : sha, status, ...scrub }),
        ...(named ? { route: named } : {}),
      };
      logEvent("request", { ...fields, ms: Date.now() - started }, { level: status >= 500 ? "error" : status >= 400 ? "warn" : "log", ...scrub });
      if (inputValidation && (status === 400 || status === 422)) logEvent("input_validation_fail", fields, { level: "warn", ...scrub });
    }
  };
}

/**
 * A `route` namer for withRequestLog from a React Router build's route table (`build.routes`: each route's `path` and
 * `parentId`): the full pattern of the most specific route that matches the path, such as `/blog/:slug`, so a log
 * groups a route's hits whatever the slug. A single-fetch `.data` suffix is read as its page. Static segments outrank
 * params, and params a splat, as in React Router's ranking. Undefined when nothing matches.
 * @param {Readonly<Record<string, { path?: string, parentId?: string, index?: boolean } | undefined>>} routes
 * @returns {(request: Request) => string | undefined}
 */
export function routeNamer(routes) {
  /** @param {string | undefined} id @returns {string[]} */
  const segments = (id) => {
    const route = id ? routes[id] : undefined;
    if (!route) return [];
    return [...segments(route.parentId), ...(route.path ?? "").split("/").filter(Boolean)];
  };
  const patterns = [...new Set(Object.keys(routes).map((id) => segments(id).join("/")))]
    .map((pattern) => {
      if (pattern === "") return { name: "/", test: /^\/?$/, score: 10 };
      const parts = pattern.split("/");
      const source = parts
        .map((part) => {
          if (part === "*") return "(?:/.*)?";
          const optional = part.endsWith("?");
          const bare = optional ? part.slice(0, -1) : part;
          const one = bare.startsWith(":") ? "/[^/]+" : `/${bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;
          return optional ? `(?:${one})?` : one;
        })
        .join("");
      const score = parts.reduce((sum, part) => sum + (part === "*" ? -2 : part.startsWith(":") ? 3 : part.endsWith("?") ? 1 : 10), 0);
      return { name: `/${pattern}`, test: new RegExp(`^${source}/?$`, "i"), score };
    })
    .sort((a, b) => b.score - a.score);
  return (request) => {
    let path = new URL(request.url).pathname;
    if (path.endsWith(".data")) path = path === "/_root.data" ? "/" : path.slice(0, -5);
    return patterns.find((pattern) => pattern.test.test(path))?.name;
  };
}

/**
 * Event names from the OWASP Logging Vocabulary
 * (https://cheatsheetseries.owasp.org/cheatsheets/Logging_Vocabulary_Cheat_Sheet.html), so a site's security events
 * carry the names a reader or a SIEM rule already knows.
 */
export const OWASP_EVENTS = /* @__PURE__ */ Object.freeze({
  signInSuccess: "authn_login_success",
  signInFailure: "authn_login_fail",
  authorizationFailure: "authz_fail",
  inputValidationFailure: "input_validation_fail",
  rateLimitExceeded: "excess_rate_limit_exceeded",
  signInLinkSent: "authn_token_created",
  signOut: "session_logout",
  sessionExpired: "session_expired",
  userUpdated: "user_updated",
  userDeleted: "user_deleted",
});
