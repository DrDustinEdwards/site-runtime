/**
 * @typedef {"ok" | "limited" | "unavailable"} Status
 * @typedef {{ status: Status, used: number, limit: number, retryAfterSeconds: number, window?: number, detail?: string }} Verdict
 */
/**
 * One use of `key` against `rules`. `onUnavailable` is required, with no default, so every call site
 * states whether a missing or failing counter lets the request through. "allow" still returns
 * status "unavailable" and logs a structured line: the failure is reported, never swallowed.
 *
 * @param {{ idFromName: (name: string) => any, get: (id: any) => { hit: (rules: import("./core.mjs").Rule[]) => Promise<import("./core.mjs").Hit> } } | undefined} namespace
 * @param {string} key
 * @param {import("./core.mjs").Rule[]} rules
 * @param {{ onUnavailable: "allow" | "refuse" }} options
 * @returns {Promise<Verdict>}
 */
export function limit(namespace: {
    idFromName: (name: string) => any;
    get: (id: any) => {
        hit: (rules: import("./core.mjs").Rule[]) => Promise<import("./core.mjs").Hit>;
    };
} | undefined, key: string, rules: import("./core.mjs").Rule[], options: {
    onUnavailable: "allow" | "refuse";
}): Promise<Verdict>;
/**
 * Whether the caller must stop here: `limited` always, `unavailable` only when the site chose to refuse.
 * @param {Verdict} verdict
 * @param {"allow" | "refuse"} onUnavailable
 */
export function mustStop(verdict: Verdict, onUnavailable: "allow" | "refuse"): boolean;
/**
 * The refusal: 429 with the time left in the window, or 503 with Retry-After 60 when the counter is
 * unavailable and the site refuses. Never a success code.
 * @param {Verdict} verdict
 */
export function limitedResponse(verdict: Verdict): Response;
/**
 * A key for a request: `prefix:ip`. Without a client IP header the request shares one `prefix:anon`
 * bucket and `anonymous` is true, so a site can see it happened.
 * @param {string} prefix
 * @param {Request} request
 */
export function ipKey(prefix: string, request: Request): {
    key: string;
    anonymous: boolean;
};
/**
 * A key for an email address: `prefix:` and the SHA-256 of the address trimmed and lower-cased, so `A@x.test ` shares
 * `a@x.test`'s bucket and the counter's name never holds the address. Null for an empty or missing address.
 * @param {string} prefix
 * @param {unknown} email
 */
export function emailKey(prefix: string, email: unknown): Promise<string | null>;
/**
 * A path as the router sees it: percent-decoded, repeated slashes collapsed, no trailing slash, lower case.
 * @param {string} pathname
 */
export function normalizePath(pathname: string): string;
/**
 * The first rule whose path matches the request, so `/LOGIN`, `/login///` and `/%4cogin` cannot slip
 * past a rule for `/login`. A rule is `{ path, prefix?, methods? }`.
 * @template {{ path: string, prefix?: boolean, methods?: string[] }} R
 * @param {Request} request
 * @param {R[]} rules
 * @returns {R | undefined}
 */
export function matchRule<R extends {
    path: string;
    prefix?: boolean;
    methods?: string[];
}>(request: Request, rules: R[]): R | undefined;
export type Status = "ok" | "limited" | "unavailable";
export type Verdict = {
    status: Status;
    used: number;
    limit: number;
    retryAfterSeconds: number;
    window?: number;
    detail?: string;
};
