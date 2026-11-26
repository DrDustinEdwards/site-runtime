/**
 * The deployed commit, from the DEPLOY_SHA var devkit's worker-deploy.yml sets (`sha-var: DEPLOY_SHA`); its live gate
 * polls /health until it reports the commit it shipped. Trimmed and lowercased; anything that is not 7 to 40 hex
 * characters reads as absent, so a stray value never reaches the body. A manual deploy has none: `fallback` is what is
 * reported then (carrel's AI door reports "unknown", which the live gate reads as not yet this run's commit).
 * @template {string | undefined} [F=undefined]
 * @param {unknown} env the Worker's env
 * @param {{ fallback?: F }} [options]
 * @returns {string | F}
 */
export function deployedSha<F extends string | undefined = undefined>(env: unknown, { fallback }?: {
    fallback?: F;
}): string | F;
/**
 * When this version was deployed, from the CF_VERSION_METADATA binding's `timestamp`; undefined when the config has no
 * such binding or the time does not parse. cronCheck's `deployedAt` takes it, so a job is "never ran" only once its
 * window has passed since the deploy.
 * @param {unknown} env the Worker's env
 * @returns {Date | undefined}
 */
export function deployedAt(env: unknown): Date | undefined;
