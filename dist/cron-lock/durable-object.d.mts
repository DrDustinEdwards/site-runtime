/**
 * One job's mutex, addressed by `idFromName(jobName)`, so two overlapping firings of one job cannot both run. A lease
 * with a fence: `acquire` answers the holder's token or null when held, and only that token releases.
 * @template [E=Cloudflare.Env]
 * @extends {DurableObject<E>}
 */
export class CronLock<E = Cloudflare.Env> extends DurableObject<E, any> {
    constructor(ctx: DurableObjectState, env: E);
    /**
     * Take the lock for up to `leaseMs`: the holder's token, or null when another run holds it.
     * @param {number} leaseMs
     */
    acquire(leaseMs: number): Promise<string | null>;
    /**
     * Free the lock, only for the run that holds it.
     * @param {string} token
     */
    release(token: string): Promise<void>;
    /** When the lease ends, or null; never the token, which is the fence. */
    peek(): Promise<number | null>;
    #private;
}
/**
 * The ticker: one instance whose alarm runs a site's sub-hourly jobs every `intervalMs` whether or not Cloudflare fires
 * the trigger. A site extends it with `run()` (its jobs, through runJobs) and calls ensureTickerArmed from scheduled()
 * and queue(), never from fetch().
 * @template [E=Cloudflare.Env]
 * @extends {DurableObject<E>}
 */
export class CronTicker<E = Cloudflare.Env> extends DurableObject<E, any> {
    constructor(ctx: DurableObjectState, env: E);
    /** How often the alarm fires. */
    get intervalMs(): number;
    /** @returns {Promise<unknown>} */
    run(): Promise<unknown>;
    /** Set the alarm if none is set; true when it set one. */
    ensureArmed(): Promise<boolean>;
    alarm(): Promise<void>;
}
import { DurableObject } from "cloudflare:workers";
