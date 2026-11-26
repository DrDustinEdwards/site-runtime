/**
 * The SDK options for one invocation. Always an object, never undefined: with undefined the SDK reads `SENTRY_DSN`
 * from the env itself and would send with none of the scrubbing below.
 * @param {{ SENTRY_DSN?: string }} env
 * @param {import("./log.mjs").ScrubOptions} [scrub]
 * @returns {import("@sentry/cloudflare").CloudflareOptions}
 */
export function sentryOptions(env: {
    SENTRY_DSN?: string;
}, scrub?: import("./log.mjs").ScrubOptions): import("@sentry/cloudflare").CloudflareOptions;
/**
 * A Worker's handler (or a WorkerEntrypoint class) with Sentry's per-invocation client around fetch, scheduled, queue
 * and email, reporting with `sentryOptions`.
 * @template T
 * @param {T} handler
 * @param {import("./log.mjs").ScrubOptions} [scrub]
 * @returns {T}
 */
export function withSiteSentry<T>(handler: T, scrub?: import("./log.mjs").ScrubOptions): T;
/**
 * One request under its own Sentry client, for a WorkerEntrypoint's fetch that a site may subclass (the Renderer):
 * withSiteSentry on the class would construct the base and drop the subclass's overrides.
 * @param {Request} request
 * @param {{ SENTRY_DSN?: string }} env
 * @param {ExecutionContext} ctx
 * @param {import("./log.mjs").ScrubOptions} scrub
 * @param {() => Promise<Response>} handler
 * @returns {Promise<Response>}
 */
export function withSentryRequest(request: Request, env: {
    SENTRY_DSN?: string;
}, ctx: ExecutionContext, scrub: import("./log.mjs").ScrubOptions, handler: () => Promise<Response>): Promise<Response>;
