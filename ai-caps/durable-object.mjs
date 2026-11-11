// A Workers built-in, not an npm package.
import { DurableObject } from "cloudflare:workers";
import { consume, ensureBudgetTable, resetBudget, spent, windowKey } from "./core.mjs";

/**
 * The site-wide AI budget: one instance (`idFromName("global")`) counts the uses of the day or the month and refuses the
 * one past the cap, atomically. A Worker exports and binds it as its own class. One that already has a class (the rate
 * limiter's) calls core.mjs's functions from its own methods instead.
 */
export class DailyBudget extends DurableObject {
  /**
   * @param {DurableObjectState} ctx
   * @param {unknown} env
   */
  constructor(ctx, env) {
    super(ctx, /** @type {never} */ (env));
    ensureBudgetTable(ctx.storage.sql);
  }

  /**
   * Count one use unless `limit` is reached in the window.
   * @param {number} limit
   * @param {"day" | "month"} [window] the UTC day (default) or month
   * @param {number} [nowMs]
   */
  consume(limit, window = "day", nowMs = Date.now()) {
    return consume(this.ctx.storage.sql, windowKey(window, new Date(nowMs)), limit);
  }

  /**
   * The window's spend, counting nothing.
   * @param {"day" | "month"} [window]
   * @param {number} [nowMs]
   */
  peek(window = "day", nowMs = Date.now()) {
    const key = windowKey(window, new Date(nowMs));
    return { window: key, count: spent(this.ctx.storage.sql, key) };
  }

  reset() {
    resetBudget(this.ctx.storage.sql);
  }
}
