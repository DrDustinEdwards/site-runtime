/** The shared GitHub REST pieces (github.mjs): headers, App installation tokens, paged lists, JSON reads, the dispatch probe, pull request URLs. */

/** A fetch of `https://api.github.com${path}` that adds the caller's own token, timeout and cache. */
export type GithubCall = (path: string, init?: RequestInit) => Promise<Response>;

export const GITHUB_API: "https://api.github.com";
export const GITHUB_API_VERSION: "2022-11-28";
/** Accept, X-GitHub-Api-Version, User-Agent and, when given, the bearer. */
export function githubHeaders(
  token: string | null | undefined,
  userAgent: string,
): Record<string, string>;
/** An installation token, narrowed to `repositories` and `permissions` when given. */
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
}): Promise<{ token: string; expiresAt: number; installationId: string }>;
/** `path` with `per_page` and `page` added. */
export function pagePath(path: string, perPage: number, page: number): string;
/** Every page of a list, by Link rel="next"; `problem` says when it was not read whole. */
export function readAllPages<T = unknown>(
  call: (path: string) => Promise<Response>,
  path: string,
  options: { maxPages: number; perPage?: number; rowsOf?: (body: unknown) => T[] | undefined },
): Promise<{ items: T[]; problem: string | null }>;
/** A GET's JSON; a refusal throws "GitHub answered <status> for <path>". */
export function githubJson(
  call: (path: string) => Promise<Response>,
  path: string,
): Promise<unknown>;
export const DISPATCH_PROBE_REF: "permission-probe-no-such-ref";
/** Whether the caller holds Actions: Write for `workflow`, by a dispatch on a ref that does not exist (422 = yes). */
export function canDispatch(
  call: GithubCall,
  owner: string,
  repo: string,
  workflow: string,
): Promise<{ ok: boolean; status: number }>;
/** A pull request URL, unanchored; groups are owner, repo, number. */
export const PR_URL_SOURCE: string;
/** The owner, repo and number of a pull request URL (anchored), or null. */
export function parsePrUrl(
  ref: string | null | undefined,
): { owner: string; repo: string; number: number } | null;
