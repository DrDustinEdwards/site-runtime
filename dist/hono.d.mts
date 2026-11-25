/**
 * @typedef {{ req: { raw: Request, header(name: string): string | undefined } }} Ctx
 */
/**
 * The operator bearer: a Worker that calls this API (the admin MCP over a service binding) sends
 * `Authorization: Bearer <token>` and names the acting admin in `actorHeader`. The bearer proves the caller is the
 * operator and grants nothing by itself (held to ./operator's rules: a token shorter than MIN_TOKEN_LENGTH closes the
 * door with a 503): `resolveActor` reads that admin from the site's own store, and the actor then
 * goes through the same checks a signed-in admin does. A request with no Authorization header passes untouched. Each
 * refusal is logged under OWASP's names with its reason, never the token.
 * @template {Ctx} [C=Ctx]
 * @template {Record<string, unknown>} [A=Record<string, unknown>]
 * @param {{ token: (c: C) => string | undefined, actorHeader: string,
 *   resolveActor: (c: C, id: string) => Promise<A | null>,
 *   onActor: (c: C, actor: A) => void, door?: string }} options
 * @returns {(c: C, next: () => Promise<unknown>) => Promise<unknown>}
 */
export function operatorBearer<C extends Ctx = Ctx, A extends Record<string, unknown> = Record<string, unknown>>({ token, actorHeader, resolveActor, onActor, door }: {
    token: (c: C) => string | undefined;
    actorHeader: string;
    resolveActor: (c: C, id: string) => Promise<A | null>;
    onActor: (c: C, actor: A) => void;
    door?: string;
}): (c: C, next: () => Promise<unknown>) => Promise<unknown>;
/**
 * A rate limit on site-runtime's RateLimiter Durable Object (./rate-limit): one bucket per `bucket` and caller, the
 * caller being `who(c)` (a user id) or, signed out, the edge address (clientIp). `onUnavailable` is required, as
 * limit() asks. Over the limit is logged and refused 429 `rate_limited`.
 * @template {Ctx} [C=Ctx]
 * @param {{ limiter: (c: C) => Parameters<typeof limit>[0], bucket: string, rules: { limit: number, windowSeconds: number }[],
 *   who?: (c: C) => string | undefined, onUnavailable: "allow" | "refuse" }} options
 * @returns {(c: C, next: () => Promise<unknown>) => Promise<unknown>}
 */
export function honoRateLimit<C extends Ctx = Ctx>({ limiter, bucket, rules, who, onUnavailable }: {
    limiter: (c: C) => Parameters<typeof limit>[0];
    bucket: string;
    rules: {
        limit: number;
        windowSeconds: number;
    }[];
    who?: (c: C) => string | undefined;
    onUnavailable: "allow" | "refuse";
}): (c: C, next: () => Promise<unknown>) => Promise<unknown>;
export type Ctx = {
    req: {
        raw: Request;
        header(name: string): string | undefined;
    };
};
import { limit } from "./rate-limit/limit.mjs";
