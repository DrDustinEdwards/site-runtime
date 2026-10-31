/** Access drift (access-drift.mjs): who a Cloudflare Access application lets in, against the site's admin list. */

/** The addresses an application's Allow policies let in, and the rules no list can name (a domain, everyone, Bypass). */
export type Allowed = { emails: Set<string>; open: string[] };
export type Drift = { onlyInAccess: string[]; onlyInApp: string[]; open: string[] };

/** `ADMIN_EMAILS` (comma-separated) or a file's text (lines or commas, `#` comments), lower-cased and deduplicated. */
export function parseAdminList(text: string): string[];
/** Reads the application named `appName` and its policies, groups and email lists through the Cloudflare API. */
export function accessAllowed(options: { accountId: string; appName: string; token: string; fetch?: typeof fetch }): Promise<Allowed>;
/** The differences; no drift when all three lists are empty. */
export function accessDrift(allowed: Allowed, admins: string[]): Drift;
