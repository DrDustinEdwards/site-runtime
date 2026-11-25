/** The MCP door's API leg: this Worker to its site over a service binding (see mcp-server.mjs). */

import { errorMessage } from "./log.mjs";

// THE API LEG: this Worker to its site, over a service binding. Still HTTP: the request carries the same bearer and
// crosses the same authentication and rate limit as any other. The bearer is never the client's OAuth token.

/** Why the API leg gave no answer: unconfigured, unreachable, canceled, or not JSON. Never an API refusal. */
export class ApiLegError extends Error {
  /**
   * @param {string} message
   * @param {"unconfigured" | "unreachable" | "canceled" | "malformed"} kind
   * @param {number} [status] the HTTP status, when an answer came back (malformed)
   */
  constructor(message, kind, status) {
    super(message);
    this.name = "ApiLegError";
    /** @type {"unconfigured" | "unreachable" | "canceled" | "malformed"} */
    this.kind = kind;
    /** @type {number | undefined} */
    this.status = status;
  }
}

/**
 * One request over the API leg, to `SITE_ORIGIN + path` through the `binding` named in `leg`, with the bearer from the
 * `token` var (refused under 32 characters) unless `anonymous`. Returns the status, whether it was 2xx, and the JSON body
 * (null when empty). Throws ApiLegError when unconfigured, unreachable or not JSON, and (`canceled`) when `signal`, the
 * tool call's, aborted: a client that closed the stream gets no further request sent for it.
 *
 * @param {object} env
 * @param {{ binding: string, token: string, api: string, userAgent: string, require?: string[] }} leg
 * @param {string} path
 * @param {{ method?: string, headers?: Record<string, string>, json?: unknown, anonymous?: boolean, signal?: AbortSignal }} [init]
 * @returns {Promise<{ status: number, ok: boolean, body: unknown }>}
 */
export async function callApi(env, leg, path, init = {}) {
  const vars = /** @type {Record<string, unknown>} */ (env);
  const unconfigured = (/** @type {string} */ what) =>
    new ApiLegError(
      `The MCP server is not configured: ${what}. Not configured means not open.`,
      "unconfigured",
    );
  const fetcher = /** @type {{ fetch?: unknown } | undefined} */ (vars[leg.binding]);
  if (!fetcher || typeof fetcher.fetch !== "function")
    throw unconfigured(`the ${leg.binding} service binding is missing`);
  if (!vars.SITE_ORIGIN) throw unconfigured("SITE_ORIGIN is unset");
  const token = vars[leg.token];
  if (!init.anonymous && (typeof token !== "string" || token.length < 32))
    throw unconfigured(`${leg.token} is unset or shorter than 32 characters`);
  for (const name of leg.require ?? [])
    if (typeof vars[name] !== "string" || !String(vars[name]).trim())
      throw unconfigured(`${name} is unset`);

  // A path naming another origin ("//host", "https://host") would carry the bearer there.
  const target = new URL(path, String(vars.SITE_ORIGIN));
  if (target.origin !== new URL(String(vars.SITE_ORIGIN)).origin)
    throw new ApiLegError(
      `The path ${path} leaves ${leg.api}'s origin, so nothing was sent.`,
      "unconfigured",
    );
  const headers = new Headers({
    accept: "application/json",
    "user-agent": leg.userAgent,
    ...init.headers,
  });
  if (!init.anonymous) headers.set("authorization", `Bearer ${token}`);
  if (init.json !== undefined) headers.set("content-type", "application/json");
  const canceled = () =>
    new ApiLegError(
      `The client closed the call, so nothing more was sent to ${leg.api}.`,
      "canceled",
    );
  if (init.signal?.aborted) throw canceled();
  /** @type {Response} */
  let response;
  try {
    response =
      await /** @type {{ fetch: (url: string, init: RequestInit) => Promise<Response> }} */ (
        fetcher
      ).fetch(target.toString(), {
        method: init.method ?? (init.json === undefined ? "GET" : "POST"),
        headers,
        body: init.json === undefined ? undefined : JSON.stringify(init.json),
        signal: init.signal,
      });
  } catch (cause) {
    if (init.signal?.aborted) throw canceled();
    throw new ApiLegError(`${leg.api} could not be reached: ${errorMessage(cause)}`, "unreachable");
  }
  const raw = await response.text();
  try {
    return { status: response.status, ok: response.ok, body: raw ? JSON.parse(raw) : null };
  } catch {
    throw new ApiLegError(
      `${leg.api} returned status ${response.status} with a body that is not JSON.`,
      "malformed",
      response.status,
    );
  }
}
