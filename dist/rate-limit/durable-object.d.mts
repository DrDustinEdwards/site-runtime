/**
 * The Durable Object class a Worker exports and binds (SQLite-backed). One instance per key holds
 * every window for that key. After the longest window ends an alarm deletes its storage, so an idle
 * key's instance is released.
 *
 * A Worker that already has a Durable Object class it cannot rename can extend this one: the counting
 * lives in its own table, apart from anything the subclass stores.
 * @template [E=Cloudflare.Env]
 * @extends {DurableObject<E>}
 */
export class RateLimiter<E = Cloudflare.Env> extends DurableObject<E, any> {
    constructor(ctx: DurableObjectState, env: E);
    /**
     * @param {import("./core.mjs").Rule[]} rules
     * @param {number} [nowMs]
     */
    hit(rules: import("./core.mjs").Rule[], nowMs?: number): Promise<import("./index.mjs").Hit>;
    /**
     * Whether `rules` are spent, counting nothing (`limit(..., { peek: true })`).
     * @param {import("./core.mjs").Rule[]} rules
     * @param {number} [nowMs]
     */
    peek(rules: import("./core.mjs").Rule[], nowMs?: number): Promise<import("./index.mjs").Hit>;
    alarm(): Promise<void>;
}
import { DurableObject } from "cloudflare:workers";
