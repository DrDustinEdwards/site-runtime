/** The deployed version (deploy.mjs): its commit and deploy time. */

/** The deployed commit from DEPLOY_SHA (trimmed, lowercased, 7 to 40 hex), else `fallback` (undefined by default). */
export function deployedSha<F extends string | undefined = undefined>(
  env: unknown,
  options?: { fallback?: F },
): string | F;
/** When this version was deployed, from CF_VERSION_METADATA's timestamp; undefined without the binding. */
export function deployedAt(env: unknown): Date | undefined;
