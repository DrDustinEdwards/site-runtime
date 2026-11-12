/**
 * The one GitHub REST client piece every repo shares: the request headers, a GitHub App installation token (narrowed to
 * the repos and permissions asked for), paged lists read to the end, a JSON read that names the refusal, the
 * workflow-dispatch permission probe and the pull request URL parser. Capsid's repo access and Carrel's writing
 * repository each had their own copies.
 *
 * A caller supplies `call(path, init)`: a fetch of `https://api.github.com${path}` that adds its own token, timeout and
 * caching. The helpers that take one never see a credential.
 */

import { timedFetch } from "./http.mjs";
import { githubAppJwt } from "./jwt.mjs";

export const GITHUB_API = "https://api.github.com";
export const GITHUB_API_VERSION = "2022-11-28";

/**
 * The headers GitHub asks every REST call to send: the JSON media type, the API version, a User-Agent naming the
 * caller and, when given, the bearer.
 * @param {string | null | undefined} token
 * @param {string} userAgent
 * @returns {Record<string, string>}
 */
export function githubHeaders(token, userAgent) {
  /** @type {Record<string, string>} */
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "User-Agent": userAgent,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

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
export async function installationToken(options) {
  const { appId, privateKey, userAgent, owner, repo, repositories, permissions } = options;
  const fetcher = options.fetcher ?? timedFetch;
  const jwt = await githubAppJwt(appId, privateKey, options.now);
  const headers = githubHeaders(jwt, userAgent);
  let id = options.installationId == null ? null : String(options.installationId);
  if (id === null) {
    if (!owner || !repo)
      throw new TypeError("installationToken needs installationId or owner and repo");
    const found = await fetcher(`${GITHUB_API}/repos/${owner}/${repo}/installation`, { headers });
    if (!found.ok) {
      const detail = (await found.text()).slice(0, 300);
      throw new Error(
        `GitHub did not find the App's installation on ${owner}/${repo} (${found.status}): ${detail}` +
          (found.status === 404
            ? " (404: the App is not installed on this repo; the credentials are fine)"
            : ""),
      );
    }
    id = String(/** @type {{ id: number }} */ (await found.json()).id);
  }
  /** @type {Record<string, unknown>} */
  const body = {};
  if (repositories) body.repositories = repositories;
  if (permissions) body.permissions = permissions;
  const minted = await fetcher(`${GITHUB_API}/app/installations/${id}/access_tokens`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!minted.ok) {
    const detail = (await minted.text()).slice(0, 300);
    throw new Error(
      `GitHub refused an installation token for installation ${id} (${minted.status}): ${detail}`,
    );
  }
  const data = /** @type {{ token: string; expires_at: string }} */ (await minted.json());
  return { token: data.token, expiresAt: Date.parse(data.expires_at), installationId: id };
}

/**
 * `path` with `per_page` and `page` added, after any query it already has.
 * @param {string} path
 * @param {number} perPage
 * @param {number} page
 */
export function pagePath(path, perPage, page) {
  return `${path}${path.includes("?") ? "&" : "?"}per_page=${perPage}&page=${page}`;
}

/**
 * Every page of a GitHub list, read to the end. The next page is asked for by number while the Link header says
 * `rel="next"` (a short page is not the end test: GitHub may serve fewer than per_page with more to come). A list not
 * read whole comes back with `problem` set rather than as if it were complete: a page refused, or more than
 * `maxPages` (then `truncated` is true too).
 * @template T
 * @param {(path: string) => Promise<Response>} call
 * @param {string} path
 * @param {{ maxPages: number; perPage?: number; rowsOf?: (body: unknown) => T[] | undefined }} options
 * @returns {Promise<{ items: T[]; problem: string | null; truncated: boolean }>}
 */
export async function readAllPages(call, path, options) {
  const perPage = options.perPage ?? 100;
  const rowsOf = options.rowsOf ?? ((body) => /** @type {T[]} */ (body));
  /** @type {T[]} */
  const items = [];
  for (let page = 1; page <= options.maxPages; page++) {
    const resp = await call(pagePath(path, perPage, page));
    if (!resp.ok) {
      await resp.body?.cancel();
      return {
        items,
        problem: `page ${page} of ${path.split("?")[0]} returned ${resp.status}`,
        truncated: false,
      };
    }
    items.push(...(rowsOf(await resp.json()) ?? []));
    if (!/rel="next"/.test(resp.headers.get("Link") ?? ""))
      return { items, problem: null, truncated: false };
  }
  return {
    items,
    problem: `${path.split("?")[0]} has more than ${options.maxPages} pages`,
    truncated: true,
  };
}

/**
 * The JSON of a GitHub GET. A refusal throws `GitHub answered <status> for <path>` (the query left out) after
 * releasing the body.
 * @param {(path: string) => Promise<Response>} call
 * @param {string} path
 * @returns {Promise<unknown>}
 */
export async function githubJson(call, path) {
  const resp = await call(path);
  if (!resp.ok) {
    await resp.body?.cancel();
    throw new Error(`GitHub answered ${resp.status} for ${path.split("?")[0]}`);
  }
  return resp.json();
}

/** The ref the probe asks for; it must never exist as a branch. */
export const DISPATCH_PROBE_REF = "permission-probe-no-such-ref";

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
export async function canDispatch(call, owner, repo, workflow) {
  const resp = await call(
    `/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: DISPATCH_PROBE_REF }),
    },
  );
  await resp.body?.cancel();
  return { ok: resp.status === 422 || resp.status === 204, status: resp.status };
}

/**
 * A pull request URL as GitHub writes it, `https://github.com/<owner>/<repo>/pull/<number>`; groups 1 to 3 are the
 * owner, repo and number. Unanchored, to find one inside text.
 */
export const PR_URL_SOURCE = String.raw`https:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/pull\/(\d+)`;
const PR_URL_EXACT = new RegExp(`^${PR_URL_SOURCE}(?:[/?#].*)?$`);

/**
 * The owner, repo and number of a pull request URL, or null. Anchored at both ends: text that merely mentions a pull
 * request is not one. A trailing `/files`, query or fragment is allowed.
 * @param {string | null | undefined} ref
 * @returns {{ owner: string; repo: string; number: number } | null}
 */
export function parsePrUrl(ref) {
  if (!ref) return null;
  const match = PR_URL_EXACT.exec(ref.trim());
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}
