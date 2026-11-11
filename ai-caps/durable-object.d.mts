import { DurableObject } from "cloudflare:workers";

/** The site-wide AI budget (ai-caps/durable-object.mjs): one instance, `idFromName("global")`. */
export declare class DailyBudget<E = Cloudflare.Env> extends DurableObject<E> {
  /** Count one use unless `limit` is reached in the UTC day (default) or month. */
  consume(limit: number, window?: "day" | "month", nowMs?: number): { ok: boolean; spent: number };
  /** The window's key and spend, counting nothing. */
  peek(window?: "day" | "month", nowMs?: number): { window: string; count: number };
  reset(): void;
}
