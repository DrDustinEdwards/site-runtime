/**
 * Access drift (I2): the addresses a Cloudflare Access application lets in, read from its policies through the
 * Cloudflare API, against the admins the site itself holds (`ADMIN_EMAILS`), so a person removed from one and not the
 * other is found. `bin/access-drift.mjs` runs it in a scheduled CI job.
 *
 * What an Allow policy lets in is the union of its include rules, less its exclude rules: an `email` rule is one
 * address, an `email_list` rule the addresses on a Zero Trust list, a `group` rule an Access group's own include less
 * its exclude, read the same way. Every other include rule (an email domain, everyone, an identity provider's group, a
 * country) admits people no list can name, so it is reported as an open rule and counts as drift. A Bypass policy lets
 * anyone in and is reported the same way. Require rules only narrow who gets in and are not read. The token is sent in
 * the Authorization header and never printed or put in an error.
 *
 * THE SITE'S LIST WITHOUT A COPY IN GITHUB: the site serves its own list, hashed, at a path behind its Access
 * application (`adminListResponse`, ADMIN_LIST_PATH by default), to an Access service token only. Each answer has a
 * fresh random salt and the SHA-256 of salt and address for each admin (`adminHash`), so the job never holds the
 * addresses and the answer cannot be matched against a precomputed table. The job hashes each address Access lets in
 * with the same salt and compares (`accessDriftHashed`): an address Access lets in that the site does not hold is named
 * (masked in a log); an admin the site holds that Access does not let in can only be counted.
 */
import { verifyAccessRequest } from "./access.mjs";
import { base64url, sha256Hex } from "./encoding.mjs";
import { logEvent } from "./log.mjs";

const API = "https://api.cloudflare.com/client/v4";

/** Where a site serves its hashed admin list unless it names another path; under /admin, which its Access app covers. */
export const ADMIN_LIST_PATH = "/admin/access-drift";

/**
 * @typedef {Record<string, any>} Rule an Access rule, `{ email: { email } }`, `{ group: { id } }` and so on
 * @typedef {{ emails: Set<string>, open: string[] }} Allowed
 * @typedef {{ onlyInAccess: string[], onlyInApp: string[], open: string[] }} Drift
 */

/** An address as both lists compare it. @param {string} email */
const normal = (email) => email.trim().toLowerCase();

/**
 * The site's admin list from `ADMIN_EMAILS` (comma-separated) or a file (one address per line or comma-separated,
 * `#` starts a comment), lower-cased, blanks dropped.
 * @param {string} text
 * @returns {string[]}
 */
export function parseAdminList(text) {
  return [
    ...new Set(
      text
        .split("\n")
        .map((line) => line.replace(/#.*/, ""))
        .join(",")
        .split(",")
        .map(normal)
        .filter(Boolean),
    ),
  ];
}

/**
 * Who an Access application lets in, by the application's name.
 * @param {{ accountId: string, appName: string, token: string, fetch?: typeof fetch }} options
 * @returns {Promise<Allowed>}
 */
export async function accessAllowed({ accountId, appName, token, fetch: get = globalThis.fetch }) {
  /** @param {string} path @returns {Promise<{ result: any, result_info?: { page?: number, total_pages?: number } }>} */
  const call = async (path) => {
    const response = await get(`${API}/accounts/${accountId}${path}`, { headers: { authorization: `Bearer ${token}` } });
    const body = /** @type {any} */ (await response.json().catch(() => ({})));
    if (!response.ok || body.success === false) {
      const why = (body.errors ?? []).map((/** @type {{ message?: string }} */ e) => e.message).filter(Boolean).join("; ");
      throw new Error(`Cloudflare API ${path.split("?")[0]}: ${response.status}${why ? ` ${why}` : ""}`);
    }
    return body;
  };
  /** Every page of a list. @param {string} path */
  const all = async (path) => {
    const rows = [];
    for (let page = 1; ; page++) {
      const body = await call(`${path}${path.includes("?") ? "&" : "?"}page=${page}&per_page=100`);
      rows.push(...(Array.isArray(body.result) ? body.result.flat() : []));
      if (!body.result_info?.total_pages || page >= body.result_info.total_pages) return rows;
    }
  };

  const apps = (await all("/access/apps")).filter((app) => app.name === appName);
  if (apps.length !== 1) throw new Error(`${apps.length === 0 ? "no" : "more than one"} Access application named "${appName}"`);
  const policies = await all(`/access/apps/${apps[0].id}/policies`);

  /** @type {Set<string>} */
  const emails = new Set();
  /** @type {string[]} */
  const open = [];
  /** @type {Map<string, Promise<Set<string>>>} */
  const lists = new Map();
  /** @type {Map<string, Promise<{ emails: Set<string>, open: string[] }>>} */
  const groups = new Map();

  /** The addresses on a Zero Trust list. @param {string} id */
  const list = (id) => {
    if (!lists.has(id)) lists.set(id, all(`/gateway/lists/${id}/items`).then((items) => new Set(items.map((item) => normal(String(item.value))))));
    return /** @type {Promise<Set<string>>} */ (lists.get(id));
  };
  /**
   * The addresses a set of include and exclude rules lets in, and the rules no list can name.
   * @param {Rule[]} include @param {Rule[]} exclude @param {string} where @param {string[]} seen groups on the way, against a loop
   * @returns {Promise<{ emails: Set<string>, open: string[] }>}
   */
  const resolve = async (include, exclude, where, seen) => {
    /** @type {Set<string>} */
    const inside = new Set();
    /** @type {string[]} */
    const wide = [];
    for (const rule of include ?? []) {
      if (rule.email?.email) inside.add(normal(rule.email.email));
      else if (rule.email_list?.id) for (const email of await list(rule.email_list.id)) inside.add(email);
      else if (rule.group?.id) {
        const found = await group(rule.group.id, seen);
        for (const email of found.emails) inside.add(email);
        wide.push(...found.open);
      } else wide.push(`${where}: ${describe(rule)}`);
    }
    for (const rule of exclude ?? []) {
      if (rule.email?.email) inside.delete(normal(rule.email.email));
      else if (rule.email_list?.id) for (const email of await list(rule.email_list.id)) inside.delete(email);
      else if (rule.group?.id) for (const email of (await group(rule.group.id, seen)).emails) inside.delete(email);
    }
    return { emails: inside, open: wide };
  };
  /** An Access group's addresses. @param {string} id @param {string[]} seen */
  const group = (id, seen) => {
    if (seen.includes(id)) return Promise.resolve({ emails: new Set(), open: [] });
    if (!groups.has(id)) {
      groups.set(
        id,
        call(`/access/groups/${id}`).then(({ result }) => resolve(result.include, result.exclude, `group "${result.name ?? id}"`, [...seen, id])),
      );
    }
    return /** @type {Promise<{ emails: Set<string>, open: string[] }>} */ (groups.get(id));
  };

  for (const policy of policies) {
    const name = `policy "${policy.name ?? policy.id}"`;
    if (policy.decision === "bypass") {
      open.push(`${name}: Bypass lets anyone in`);
      continue;
    }
    if (policy.decision !== "allow") continue;
    // A reusable policy listed without its rules is read on its own.
    const full = policy.include ? policy : (await call(`/access/policies/${policy.id}`)).result;
    const found = await resolve(full.include, full.exclude, name, []);
    for (const email of found.emails) emails.add(email);
    open.push(...found.open);
  }
  return { emails, open };
}

/** A rule no list can name, in words. @param {Rule} rule */
function describe(rule) {
  if (rule.email_domain?.domain) return `every address at ${rule.email_domain.domain}`;
  if (rule.everyone) return "everyone";
  const [kind] = Object.keys(rule);
  return `a ${kind ?? "blank"} rule`;
}

/**
 * The differences between who Access lets in and the site's admins: in Access and not the app, in the app and not
 * Access, and Access's open rules. No drift when all three are empty.
 * @param {Allowed} allowed
 * @param {string[]} admins
 * @returns {Drift}
 */
export function accessDrift(allowed, admins) {
  const app = new Set(admins.map(normal));
  return {
    onlyInAccess: [...allowed.emails].filter((email) => !app.has(email)).sort(),
    onlyInApp: [...app].filter((email) => !allowed.emails.has(email)).sort(),
    open: [...allowed.open],
  };
}

/**
 * The hash of one admin address under a salt: SHA-256 of `salt:address`, the address trimmed and lower-cased, as hex.
 * @param {string} salt @param {string} email
 */
export async function adminHash(salt, email) {
  return sha256Hex(`${salt}:${normal(email)}`);
}

/**
 * The site's side: its admin list, hashed (`{ salt, hashes }`, the hashes sorted), for the drift job. Only a GET that
 * Access let through with a service token (a verified Access token for this application, `ACCESS_TEAM_DOMAIN` and
 * `ACCESS_AUD`, that names a `common_name` and no person), and with `clientId` that token alone, is answered; anything
 * else is 404, so the route shows nothing to a person or a stranger. `admins` is the site's list
 * (`adminEmails(env)` from `./access` for most). No-store.
 * @param {Request} request
 * @param {{ ACCESS_TEAM_DOMAIN?: string, ACCESS_AUD?: string }} env
 * @param {{ admins: readonly string[], clientId?: string, keys?: import("./access-login.d.mts").KeySource, now?: number }} options
 * @returns {Promise<Response>}
 */
export async function adminListResponse(request, env, { admins, clientId, keys, now }) {
  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
  const refuse = (/** @type {string} */ reason) => {
    logEvent("admin_list_refused", { reason }, { level: "warn" });
    return new Response("Not Found", { status: 404, headers });
  };
  if (request.method !== "GET") return refuse("method");
  let verdict;
  try {
    verdict = await verifyAccessRequest(request, { teamDomain: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD, keys, now });
  } catch (error) {
    logEvent("access_keys_unreachable", { error }, { level: "error" });
    return new Response("Unavailable", { status: 503, headers });
  }
  if (!verdict.ok) return refuse(verdict.reason);
  const name = verdict.claims.common_name;
  if (typeof name !== "string" || !name || verdict.claims.email) return refuse("not-a-service-token");
  if (clientId && name !== clientId) return refuse("other-service-token");
  const salt = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const hashes = (await Promise.all([...new Set(admins.map(normal).filter(Boolean))].map((email) => adminHash(salt, email)))).sort();
  return new Response(JSON.stringify({ salt, hashes }), { headers: { ...headers, "Content-Type": "application/json" } });
}

/**
 * The job's side: the site's hashed list from `url`, through Access with the service token's id and secret (the
 * CF-Access-Client-Id and CF-Access-Client-Secret headers). Throws, naming the status, when Access or the site refuses
 * or the answer is not a list; never with the secret in it.
 * @param {string} url
 * @param {{ clientId: string, clientSecret: string, fetch?: typeof fetch }} options
 * @returns {Promise<{ salt: string, hashes: string[] }>}
 */
export async function fetchAdminList(url, { clientId, clientSecret, fetch: get = globalThis.fetch }) {
  const response = await get(url, {
    headers: { "CF-Access-Client-Id": clientId, "CF-Access-Client-Secret": clientSecret, Accept: "application/json" },
    redirect: "manual",
  });
  if (response.status >= 300 && response.status < 400) throw new Error(`${url} redirected (${response.status}): Access did not take the service token`);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const body = /** @type {any} */ (await response.json().catch(() => null));
  if (!body || typeof body.salt !== "string" || !Array.isArray(body.hashes) || !body.hashes.every((/** @type {unknown} */ h) => typeof h === "string")) {
    throw new Error(`${url} did not answer with a hashed admin list`);
  }
  return { salt: body.salt, hashes: body.hashes };
}

/**
 * The differences between who Access lets in and the site's hashed list: the addresses Access lets in whose hash the
 * site does not hold, how many of the site's hashes no address in Access matches, and Access's open rules.
 * @param {Allowed} allowed
 * @param {{ salt: string, hashes: string[] }} list
 * @returns {Promise<{ onlyInAccess: string[], onlyInAppCount: number, admins: number, open: string[] }>}
 */
export async function accessDriftHashed(allowed, { salt, hashes }) {
  const app = new Set(hashes);
  const matched = new Set();
  /** @type {string[]} */
  const onlyInAccess = [];
  for (const email of allowed.emails) {
    const hash = await adminHash(salt, email);
    if (app.has(hash)) matched.add(hash);
    else onlyInAccess.push(email);
  }
  return { onlyInAccess: onlyInAccess.sort(), onlyInAppCount: app.size - matched.size, admins: app.size, open: [...allowed.open] };
}
