import { sha256Hex } from "../encoding.mjs";

/**
 * @typedef {"ok" | "limited" | "unavailable"} Status
 * @typedef {{ status: Status, used: number, limit: number, retryAfterSeconds: number, window?: number, detail?: string }} Verdict
 */

/**
 * One use of `key` against `rules`. `onUnavailable` is required, with no default, so every call site
 * states whether a missing or failing counter lets the request through. "allow" still returns
 * status "unavailable" and logs a structured line: the failure is reported, never swallowed.
 *
 * @param {{ idFromName: (name: string) => any, get: (id: any) => { hit: (rules: import("./core.mjs").Rule[]) => Promise<import("./core.mjs").Hit> } } | undefined} namespace
 * @param {string} key
 * @param {import("./core.mjs").Rule[]} rules
 * @param {{ onUnavailable: "allow" | "refuse" }} options
 * @returns {Promise<Verdict>}
 */
export async function limit(namespace, key, rules, options) {
  if (options?.onUnavailable !== "allow" && options?.onUnavailable !== "refuse") {
    throw new TypeError('onUnavailable must be "allow" or "refuse"');
  }
  const first = rules?.[0];
  /** @param {string} detail @returns {Verdict} */
  const unavailable = (detail) => {
    console.error(JSON.stringify({ event: "rate-limit-unavailable", bucket: bucket(key), onUnavailable: options.onUnavailable, detail }));
    return { status: "unavailable", used: 0, limit: first?.limit ?? 0, retryAfterSeconds: 60, detail };
  };
  if (!namespace) return unavailable("no Durable Object binding");
  try {
    const hit = await namespace.get(namespace.idFromName(key)).hit(rules);
    return { status: hit.ok ? "ok" : "limited", used: hit.used, limit: hit.limit, retryAfterSeconds: hit.retryAfterSeconds, window: hit.window };
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}

/**
 * The key without its last part, so a log line never carries an IP or an account.
 * @param {string} key
 */
function bucket(key) {
  const parts = String(key).split(":");
  return parts.length > 1 ? parts.slice(0, -1).join(":") : parts[0];
}

/**
 * Whether the caller must stop here: `limited` always, `unavailable` only when the site chose to refuse.
 * @param {Verdict} verdict
 * @param {"allow" | "refuse"} onUnavailable
 */
export function mustStop(verdict, onUnavailable) {
  return verdict.status === "limited" || (verdict.status === "unavailable" && onUnavailable === "refuse");
}

/**
 * The refusal: 429 with the time left in the window, or 503 with Retry-After 60 when the counter is
 * unavailable and the site refuses. Never a success code.
 * @param {Verdict} verdict
 */
export function limitedResponse(verdict) {
  const unavailable = verdict.status === "unavailable";
  return new Response(unavailable ? "Temporarily unavailable" : "Too many requests", {
    status: unavailable ? 503 : 429,
    headers: { "Retry-After": String(verdict.retryAfterSeconds), "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/**
 * A key for a request: `prefix:ip`. Without a client IP header the request shares one `prefix:anon`
 * bucket and `anonymous` is true, so a site can see it happened.
 * @param {string} prefix
 * @param {Request} request
 */
export function ipKey(prefix, request) {
  const ip = request.headers.get("CF-Connecting-IP")?.trim();
  return { key: `${prefix}:${ip || "anon"}`, anonymous: !ip };
}

/**
 * A key for an email address: `prefix:` and the SHA-256 of the address trimmed and lower-cased, so `A@x.test ` shares
 * `a@x.test`'s bucket and the counter's name never holds the address. Null for an empty or missing address.
 * @param {string} prefix
 * @param {unknown} email
 */
export async function emailKey(prefix, email) {
  const address = typeof email === "string" ? email.trim().toLowerCase() : "";
  return address ? `${prefix}:${await sha256Hex(address)}` : null;
}

/**
 * A path as the router sees it: percent-decoded, repeated slashes collapsed, no trailing slash, lower case.
 * @param {string} pathname
 */
export function normalizePath(pathname) {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    // A malformed escape is matched as written; it cannot be a decoded match for a rule.
  }
  path = path.replace(/\/{2,}/g, "/").toLowerCase();
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/**
 * The first rule whose path matches the request, so `/LOGIN`, `/login///` and `/%4cogin` cannot slip
 * past a rule for `/login`. A rule is `{ path, prefix?, methods? }`.
 * @template {{ path: string, prefix?: boolean, methods?: string[] }} R
 * @param {Request} request
 * @param {R[]} rules
 * @returns {R | undefined}
 */
export function matchRule(request, rules) {
  const path = normalizePath(new URL(request.url).pathname);
  return rules.find((rule) => {
    if (rule.methods && !rule.methods.includes(request.method)) return false;
    const target = normalizePath(rule.path);
    return rule.prefix ? path === target || path.startsWith(`${target}/`) : path === target;
  });
}
