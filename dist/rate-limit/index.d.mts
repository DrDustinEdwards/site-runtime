export type Hit = {
    ok: boolean;
    used: number;
    limit: number;
    retryAfterSeconds: number;
    window: number;
};
export type Verdict = {
    status: Status;
    used: number;
    limit: number;
    retryAfterSeconds: number;
    window?: number;
    detail?: string;
};
import type { Status } from "./limit.mjs";
export { hitRules, peekRules, secondsLeft, assertRules, idleDeadline, purgeExpired } from "./core.mjs";
export { limit, limitedResponse, mustStop, ipKey, emailKey, matchRule, normalizePath } from "./limit.mjs";
