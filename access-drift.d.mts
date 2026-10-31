/**
 * Access drift (access-drift.mjs): who a Cloudflare Access application lets in, against the site's admin list. The site
 * serves its list hashed with a fresh salt to an Access service token (`adminListResponse`), so the job holds no copy.
 */

/** The addresses an application's Allow policies let in, and the rules no list can name (a domain, everyone, Bypass). */
export type Allowed = { emails: Set<string>; open: string[] };
export type Drift = { onlyInAccess: string[]; onlyInApp: string[]; open: string[] };

/** `ADMIN_EMAILS` (comma-separated) or a file's text (lines or commas, `#` comments), lower-cased and deduplicated. */
export function parseAdminList(text: string): string[];
/** Reads the application named `appName` and its policies, groups and email lists through the Cloudflare API. */
export function accessAllowed(options: { accountId: string; appName: string; token: string; fetch?: typeof fetch }): Promise<Allowed>;
/** The differences; no drift when all three lists are empty. */
export function accessDrift(allowed: Allowed, admins: string[]): Drift;

/** Where a site serves its hashed admin list by default: "/admin/access-drift". */
export const ADMIN_LIST_PATH: "/admin/access-drift";
/** SHA-256 of `salt:address` (the address trimmed and lower-cased), hex. */
export function adminHash(salt: string, email: string): Promise<string>;
/**
 * The site's route: `{ salt, hashes }` for a GET carrying a verified Access token of a service token (with `clientId`,
 * that one); 404 for anything else, 503 when Access's keys cannot be fetched. No-store.
 */
export function adminListResponse(
  request: Request,
  env: { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string },
  options: { admins: readonly string[]; clientId?: string; keys?: import("./access-login.d.mts").KeySource; now?: number },
): Promise<Response>;
/** The job's fetch of that route through Access with a service token. Throws on a redirect, an error status or a bad body. */
export function fetchAdminList(
  url: string,
  options: { clientId: string; clientSecret: string; fetch?: typeof fetch },
): Promise<{ salt: string; hashes: string[] }>;
/** The differences against the hashed list: addresses only Access lets in, a count of admins Access does not, open rules. */
export function accessDriftHashed(
  allowed: Allowed,
  list: { salt: string; hashes: string[] },
): Promise<{ onlyInAccess: string[]; onlyInAppCount: number; admins: number; open: string[] }>;
