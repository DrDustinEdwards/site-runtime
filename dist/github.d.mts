/**
 * The headers GitHub asks every REST call to send: the JSON media type, the API version, a User-Agent naming the
 * caller and, when given, the bearer.
 * @param {string | null | undefined} token
 * @param {string} userAgent
 * @returns {Record<string, string>}
 */
export function githubHeaders(token: string | null | undefined, userAgent: string): Record<string, string>;
/**
 * A GitHub App installation token. Without `installationId` the installation is looked up from `owner`/`repo` (a 404
 * there means the App is not installed on the repo; the credentials are fine). `repositories` and `permissions`
 * narrow the token below what the installation allows; with neither, GitHub mints one for every repo the installation
 * covers, so pass `repositories` unless the call needs them all.
 * @param {{
 *   appId: string;
 *   privateKey: string | JsonWebKey | CryptoKey;
 *   userAgent: string;
 *   owner?: string;
 *   repo?: string;
 *   installationId?: number | string;
 *   repositories?: string[];
 *   permissions?: Record<string, "read" | "write">;
 *   fetcher?: typeof fetch;
 *   now?: number;
 * }} options
 * @returns {Promise<{ token: string; expiresAt: number; installationId: string }>}
 */
export function installationToken(options: {
    appId: string;
    privateKey: string | JsonWebKey | CryptoKey;
    userAgent: string;
    owner?: string;
    repo?: string;
    installationId?: number | string;
    repositories?: string[];
    permissions?: Record<string, "read" | "write">;
    fetcher?: typeof fetch;
    now?: number;
}): Promise<{
    token: string;
    expiresAt: number;
    installationId: string;
}>;
/**
 * Every page of a GitHub list, read to the end. The next page is asked for by number while the Link header says
 * `rel="next"` (a short page is not the end test: GitHub may serve fewer than per_page with more to come). A list not
 * read whole comes back with `problem` set rather than as if it were complete: "page N returned S" for a refused
 * page, or "more than N pages" past `maxPages` (then `truncated` is true too).
 * @template T
 * @param {(path: string) => Promise<Response>} call
 * @param {string} path
 * @param {{ maxPages: number; perPage?: number; rowsOf?: (body: unknown) => T[] | undefined }} options
 * @returns {Promise<{ items: T[]; problem: string | null; truncated: boolean }>}
 */
export function readAllPages<T>(call: (path: string) => Promise<Response>, path: string, options: {
    maxPages: number;
    perPage?: number;
    rowsOf?: (body: unknown) => T[] | undefined;
}): Promise<{
    items: T[];
    problem: string | null;
    truncated: boolean;
}>;
/**
 * The JSON of a GitHub GET. A refusal throws `GitHub answered <status> for <path>` (the query left out) after
 * releasing the body.
 * @param {(path: string) => Promise<Response>} call
 * @param {string} path
 * @returns {Promise<unknown>}
 */
export function githubJson(call: (path: string) => Promise<Response>, path: string): Promise<unknown>;
/**
 * Whether the caller may start `workflow` (its file name or id) on `owner`/`repo`, without starting it. The probe
 * dispatches the workflow on a branch that does not exist: GitHub checks permission before the ref, so a caller that
 * holds Actions: Write is answered 422 ("No ref found") and nothing runs, and one that does not is answered 403 or 404.
 * A 204 (the probe ref exists after all) also proves the permission.
 * @param {(path: string, init?: RequestInit) => Promise<Response>} call
 * @param {string} owner
 * @param {string} repo
 * @param {string} workflow
 * @returns {Promise<{ ok: boolean; status: number }>}
 */
export function canDispatch(call: (path: string, init?: RequestInit) => Promise<Response>, owner: string, repo: string, workflow: string): Promise<{
    ok: boolean;
    status: number;
}>;
/**
 * The owner, repo and number of a pull request URL, or null. Anchored at both ends: text that merely mentions a pull
 * request is not one. A trailing `/files`, query or fragment is allowed.
 * @param {string | null | undefined} ref
 * @returns {{ owner: string; repo: string; number: number } | null}
 */
export function parsePrUrl(ref: string | null | undefined): {
    owner: string;
    repo: string;
    number: number;
} | null;
/**
 * A fetch of `https://api.github.com${path}` that adds the caller's own token, timeout and cache.
 * @typedef {(path: string, init?: RequestInit) => Promise<Response>} GithubCall
 */
export const GITHUB_API: "https://api.github.com";
export const GITHUB_API_VERSION: "2022-11-28";
/** The ref the probe asks for; it must never exist as a branch. */
export const DISPATCH_PROBE_REF: "permission-probe-no-such-ref";
/**
 * A pull request URL as GitHub writes it, `https://github.com/<owner>/<repo>/pull/<number>`; groups 1 to 3 are the
 * owner, repo and number. Unanchored, to find one inside text.
 */
export const PR_URL_SOURCE: string;
/**
 * A fetch of `https://api.github.com${path}` that adds the caller's own token, timeout and cache.
 */
export type GithubCall = (path: string, init?: RequestInit) => Promise<Response>;
