/**
 * The site's admin list from a roster (`ADMIN_EMAIL`, `CO_OWNER_EMAILS`) or a file (one address per line or comma-separated,
 * `#` starts a comment), lower-cased, blanks dropped.
 * @param {string} text
 * @returns {string[]}
 */
export function parseAdminList(text: string): string[];
/**
 * Who an Access application lets in, by the application's name.
 * @param {{ accountId: string, appName: string, token: string, fetch?: typeof fetch }} options
 * @returns {Promise<Allowed>}
 */
export function accessAllowed({ accountId, appName, token, fetch: get }: {
    accountId: string;
    appName: string;
    token: string;
    fetch?: typeof fetch;
}): Promise<Allowed>;
/**
 * The differences between who Access lets in and the site's admins: in Access and not the app, in the app and not
 * Access, and Access's open rules. No drift when all three are empty.
 * @param {Allowed} allowed
 * @param {string[]} admins
 * @returns {Drift}
 */
export function accessDrift(allowed: Allowed, admins: string[]): Drift;
/**
 * The hash of one admin address under a salt: SHA-256 of `salt:address`, the address trimmed and lower-cased, as hex.
 * @param {string} salt @param {string} email
 */
export function adminHash(salt: string, email: string): Promise<string>;
/**
 * The site's side: its admin list, hashed (`{ salt, hashes }`, the hashes sorted), for the drift job. Only a GET that
 * Access let through with a service token (a verified Access token for this application, `ACCESS_TEAM_DOMAIN` and
 * `ACCESS_AUD`, that names a `common_name` and no person), and with `clientId` that token alone, is answered; anything
 * else is 404, so the route shows nothing to a person or a stranger. `admins` is the site's list
 * (`adminEmails(env)` from `./access` for most). No-store.
 * @param {Request} request
 * @param {{ ACCESS_TEAM_DOMAIN?: string, ACCESS_AUD?: string }} env
 * @param {{ admins: readonly string[], clientId?: string, keys?: import("./access-login.mjs").KeySource, now?: number }} options
 * @returns {Promise<Response>}
 */
export function adminListResponse(request: Request, env: {
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_AUD?: string;
}, { admins, clientId, keys, now }: {
    admins: readonly string[];
    clientId?: string;
    keys?: import("./access-login.mjs").KeySource;
    now?: number;
}): Promise<Response>;
/**
 * The job's side: the site's hashed list from `url`, through Access with the service token's id and secret (the
 * CF-Access-Client-Id and CF-Access-Client-Secret headers). Throws, naming the status, when Access or the site refuses
 * or the answer is not a list; never with the secret in it.
 * @param {string} url
 * @param {{ clientId: string, clientSecret: string, fetch?: typeof fetch }} options
 * @returns {Promise<{ salt: string, hashes: string[] }>}
 */
export function fetchAdminList(url: string, { clientId, clientSecret, fetch: get }: {
    clientId: string;
    clientSecret: string;
    fetch?: typeof fetch;
}): Promise<{
    salt: string;
    hashes: string[];
}>;
/**
 * The differences between who Access lets in and the site's hashed list: the addresses Access lets in whose hash the
 * site does not hold, how many of the site's hashes no address in Access matches, and Access's open rules.
 * @param {Allowed} allowed
 * @param {{ salt: string, hashes: string[] }} list
 * @returns {Promise<{ onlyInAccess: string[], onlyInAppCount: number, admins: number, open: string[] }>}
 */
export function accessDriftHashed(allowed: Allowed, { salt, hashes }: {
    salt: string;
    hashes: string[];
}): Promise<{
    onlyInAccess: string[];
    onlyInAppCount: number;
    admins: number;
    open: string[];
}>;
/** Where a site serves its hashed admin list unless it names another path; under /admin, which its Access app covers. */
export const ADMIN_LIST_PATH: "/admin/access-drift";
/**
 * an Access rule, `{ email: { email } }`, `{ group: { id } }` and so on
 */
export type Rule = Record<string, any>;
export type Allowed = {
    emails: Set<string>;
    open: string[];
};
export type Drift = {
    onlyInAccess: string[];
    onlyInApp: string[];
    open: string[];
};
