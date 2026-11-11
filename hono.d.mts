/** Hono middleware for the doors a site's API shares, with no Hono import (hono.mjs). */

type Ctx = { req: { raw: Request; header(name: string): string | undefined } };

/** The operator bearer: token check, the acting admin from `actorHeader`, OWASP-named refusal logs. */
export function operatorBearer<
  C extends Ctx = Ctx,
  A extends Record<string, unknown> = Record<string, unknown>,
>(options: {
  token: (c: C) => string | undefined;
  actorHeader: string;
  resolveActor: (c: C, id: string) => Promise<A | null>;
  onActor: (c: C, actor: A) => void;
  door?: string;
}): (c: C, next: () => Promise<unknown>) => Promise<unknown>;

/** A rate limit on the RateLimiter Durable Object, keyed on `who(c)` or the edge address; 429 over it. */
export function honoRateLimit<C extends Ctx = Ctx>(options: {
  limiter: (c: C) => Parameters<typeof import("./rate-limit/limit.mjs").limit>[0];
  bucket: string;
  rules: { limit: number; windowSeconds: number }[];
  who?: (c: C) => string | undefined;
  onUnavailable: "allow" | "refuse";
}): (c: C, next: () => Promise<unknown>) => Promise<unknown>;
