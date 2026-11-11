import { DurableObject } from "cloudflare:workers";

/** One job's fenced lease (cron-lock/durable-object.mjs), addressed by idFromName(jobName). */
export declare class CronLock<E = Cloudflare.Env> extends DurableObject<E> {
  /** The holder's token, or null when another run holds the lock. */
  acquire(leaseMs: number): Promise<string | null>;
  /** Free the lock, only for the token's holder. */
  release(token: string): Promise<void>;
  /** When the lease ends, or null; never the token. */
  peek(): Promise<number | null>;
}

/** The alarm ticker (cron-lock/durable-object.mjs): a site extends it with run(). */
export declare class CronTicker<E = Cloudflare.Env> extends DurableObject<E> {
  /** How often the alarm fires; five minutes unless overridden. */
  get intervalMs(): number;
  /** The site's jobs for one tick. */
  run(): Promise<unknown>;
  /** Set the alarm if none is set; true when it set one. */
  ensureArmed(): Promise<boolean>;
  alarm(): Promise<void>;
}
