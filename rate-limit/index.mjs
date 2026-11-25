export {
  hitRules,
  peekRules,
  secondsLeft,
  assertRules,
  idleDeadline,
  purgeExpired,
} from "./core.mjs";
export {
  limit,
  limitedResponse,
  mustStop,
  ipKey,
  emailKey,
  matchRule,
  normalizePath,
} from "./limit.mjs";

/** @import { Status } from "./limit.mjs" */

/**
 * @typedef {{ ok: boolean, used: number, limit: number, retryAfterSeconds: number, window: number }} Hit
 
 */

/**
 * @typedef {{ status: Status, used: number, limit: number, retryAfterSeconds: number, window?: number, detail?: string }} Verdict
 
 */
