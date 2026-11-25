/**
 * The site-wide AI budget: one instance (`idFromName("global")`) counts the uses of the day or the month and refuses the
 * one past the cap, atomically. A Worker exports and binds it as its own class. One that already has a class (the rate
 * limiter's) calls core.mjs's functions from its own methods instead.
 * @template [E=Cloudflare.Env]
 * @extends {DurableObject<E>}
 */
export class DailyBudget<E = Cloudflare.Env> extends DurableObject<E, any> {
    /**
     * @param {DurableObjectState} ctx
     * @param {unknown} env
     */
    constructor(ctx: DurableObjectState, env: unknown);
    /**
     * Count one use unless `limit` is reached in the window.
     * @param {number} limit
     * @param {"day" | "month"} [window] the UTC day (default) or month
     * @param {number} [nowMs]
     */
    consume(limit: number, window?: "day" | "month", nowMs?: number): {
        ok: boolean;
        spent: number;
    };
    /**
     * The window's spend, counting nothing.
     * @param {"day" | "month"} [window]
     * @param {number} [nowMs]
     */
    peek(window?: "day" | "month", nowMs?: number): {
        window: string;
        count: number;
    };
    reset(): void;
}
import { DurableObject } from "cloudflare:workers";
