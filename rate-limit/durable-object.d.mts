import { DurableObject } from "cloudflare:workers";
import type { Hit, Rule } from "./core.mjs";

export declare class RateLimiter<E = Cloudflare.Env> extends DurableObject<E> {
  hit(rules: Rule[], nowMs?: number): Promise<Hit>;
  /** Whether `rules` are spent, counting nothing. */
  peek(rules: Rule[], nowMs?: number): Promise<Hit>;
  alarm(): Promise<void>;
}
