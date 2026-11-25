/**
 * The providers' `mapProfileToUser`: it maps nothing, and notes the address the provider answered with for the
 * callback's request, so a failed callback counts against it. When that address is already over
 * SIGN_IN_FAILURE_RULES the callback stops here, before any account is read, and goes back to the sign-in's error page
 * with `?error=EMAIL_RATE_LIMITED`.
 * @param {Parameters<typeof limit>[0] | undefined} namespace
 */
export function providerAddress(namespace: Parameters<typeof limit>[0] | undefined): (/** @type {{ email?: unknown }} */ profile: {
    email?: unknown;
}) => Promise<{}>;
/**
 * The per-address limits as one plugin. Its before hooks run after the captcha plugin and Better Auth's per-IP limit
 * (both on the request, before any hook), so a request without a Turnstile pass spends nothing of an address's budget.
 * A mail is counted when asked for; a typed code, a passkey and a social sign-in are checked before (a peek, which
 * counts nothing) and counted only when they fail, in the after hook. A code is refused when the counter cannot
 * answer, and so is every code on a site with no `emailLimiter`; a mail or a passkey goes through.
 * @param {Parameters<typeof limit>[0] | undefined} namespace
 */
export function emailLimit(namespace: Parameters<typeof limit>[0] | undefined): {
    id: string;
    hooks: {
        before: {
            /** @param {{ path?: string }} ctx */
            matcher: (ctx: {
                path?: string;
            }) => boolean;
            handler: import("better-call").Middleware<import("better-call").MiddlewareOptions, (inputContext: import("better-call").MiddlewareInputContext<import("better-call").MiddlewareOptions>) => Promise<void>>;
        }[];
        after: {
            /** @param {{ path?: string }} ctx */
            matcher: (ctx: {
                path?: string;
            }) => boolean;
            handler: import("better-call").Middleware<import("better-call").MiddlewareOptions, (inputContext: import("better-call").MiddlewareInputContext<import("better-call").MiddlewareOptions>) => Promise<void>>;
        }[];
    };
};
import { limit } from "./rate-limit/index.mjs";
