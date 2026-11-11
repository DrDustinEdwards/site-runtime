/**
 * Hono middleware for the doors a site's API shares, written as plain `(c, next)` functions so nothing here imports
 * Hono (the 2026-11-11 shared-code audit, item 41d, from Foxing's packages/api). Each refusal throws an AppError
 * (./http-errors), so the app's `onError(honoErrorHandler())` answers it as problem details.
 */

import { safeEqual } from "./compare.mjs";
import { AppError, errors } from "./http-errors.mjs";
import { clientIp } from "./http.mjs";
import { OWASP_EVENTS, logEvent, requestFields } from "./log.mjs";
import { limit, mustStop } from "./rate-limit/limit.mjs";

/**
 * @typedef {{ req: { raw: Request, header(name: string): string | undefined } }} Ctx
 */

/**
 * The operator bearer: a Worker that calls this API (the admin MCP over a service binding) sends
 * `Authorization: Bearer <token>` and names the acting admin in `actorHeader`. The bearer proves the caller is the
 * operator and grants nothing by itself: `resolveActor` reads that admin from the site's own store, and the actor then
 * goes through the same checks a signed-in admin does. A request with no Authorization header passes untouched. Each
 * refusal is logged under OWASP's names with its reason, never the token.
 * @param {{ token: (c: Ctx) => string | undefined, actorHeader: string,
 *   resolveActor: (c: Ctx, id: string) => Promise<Record<string, unknown> | null>,
 *   onActor: (c: Ctx, actor: Record<string, unknown>) => void, door?: string }} options
 * @returns {(c: Ctx, next: () => Promise<unknown>) => Promise<unknown>}
 */
export function operatorBearer({ token, actorHeader, resolveActor, onActor, door = "operator" }) {
  /** @param {Request} request @param {string} reason @param {string} message */
  const refused = (request, reason, message) => {
    logEvent(
      OWASP_EVENTS.signInFailure,
      { ...requestFields(request), door, reason },
      { level: "warn" },
    );
    return new AppError(401, "unauthorized", message);
  };
  return async (c, next) => {
    const header = c.req.header("Authorization");
    if (header === undefined) return next();
    const request = c.req.raw;
    const match = /^Bearer (\S+)$/.exec(header);
    if (!match)
      throw refused(
        request,
        "not bearer",
        "Send the operator token as: Authorization: Bearer <token>.",
      );
    const expected = token(c);
    if (!expected)
      throw refused(request, "not configured", "Operator access is not configured on this Worker.");
    if (!(await safeEqual(match[1], expected)))
      throw refused(request, "wrong token", "Operator token not recognized.");
    const actorId = c.req.header(actorHeader)?.trim();
    if (!actorId)
      throw refused(request, "no actor", `Name the acting admin's user id in ${actorHeader}.`);
    const actor = await resolveActor(c, actorId);
    if (!actor) {
      logEvent(
        OWASP_EVENTS.authorizationFailure,
        { ...requestFields(request), door, reason: "unknown actor" },
        { level: "warn" },
      );
      throw errors.forbidden("The acting admin does not exist.");
    }
    onActor(c, actor);
    await next();
  };
}

/**
 * A rate limit on site-runtime's RateLimiter Durable Object (./rate-limit): one bucket per `bucket` and caller, the
 * caller being `who(c)` (a user id) or, signed out, the edge address (clientIp). `onUnavailable` is required, as
 * limit() asks. Over the limit is logged and refused 429 `rate_limited`.
 * @param {{ limiter: (c: Ctx) => Parameters<typeof limit>[0], bucket: string, rules: { limit: number, windowSeconds: number }[],
 *   who?: (c: Ctx) => string | undefined, onUnavailable: "allow" | "refuse" }} options
 * @returns {(c: Ctx, next: () => Promise<unknown>) => Promise<unknown>}
 */
export function honoRateLimit({ limiter, bucket, rules, who, onUnavailable }) {
  return async (c, next) => {
    const caller = who?.(c) ?? clientIp(c.req.raw);
    const verdict = await limit(limiter(c), `${bucket}:${caller}`, rules, { onUnavailable });
    if (mustStop(verdict, onUnavailable)) {
      logEvent(
        OWASP_EVENTS.rateLimitExceeded,
        { ...requestFields(c.req.raw), bucket },
        { level: "warn" },
      );
      throw verdict.status === "unavailable" ? errors.serviceUnavailable() : errors.rateLimited();
    }
    await next();
  };
}
