/**
 * A session read through /get-session (the browser's useSession, or the site's `auth.api.getSession`) moves its
 * `updatedAt` at most every SESSION_TOUCH_SECONDS (`sessionTouch`), after the answer through Better Auth's
 * `runInBackgroundOrAwait`; that is what the idle limit counts from. With `sessionDetails` it also fills the session's
 * place from the request's `cf`, so a site's own `auth.api.getSession` passes the request as well, through
 * `sessionLookup(request)`: `getSession(sessionLookup(request))`. A failed write is logged (`session_touch_failed`) and
 * never fails the read.
 * @param {boolean} details
 */
export function sessionTouchPlugin(details: boolean): {
    id: string;
    hooks: {
        after: {
            /** @param {{ path?: string }} ctx */
            matcher: (ctx: {
                path?: string;
            }) => boolean;
            handler: import("better-call").Middleware<import("better-call").MiddlewareOptions, (inputContext: import("better-call").MiddlewareInputContext<import("better-call").MiddlewareOptions>) => Promise<void>>;
        }[];
    };
};
/**
 * Ends a session unused for SESSION_IDLE_SECONDS (ASVS 5 v7.3.1): any request carrying its cookie (but a sign-out, which
 * is the end it wants) finds it by Better Auth's own session read, deletes it and clears the cookie; /get-session then
 * answers null, and any other route 401s with SESSION_IDLE. Runs before the route, so every route is covered, not only
 * the page's session read.
 * A function, not a top-level constant: a module-level `createAuthMiddleware(...)` call is kept by the bundler, which
 * pulled better-auth's server API (+52 KB gzip) into every auth page that imports `signInMethods`.
 */
export function sessionIdlePlugin(): {
    id: string;
    hooks: {
        before: {
            /** @param {{ path?: string, headers?: Headers }} ctx */
            matcher: (ctx: {
                path?: string;
                headers?: Headers;
            }) => boolean;
            handler: import("better-call").Middleware<import("better-call").MiddlewareOptions, (inputContext: import("better-call").MiddlewareInputContext<import("better-call").MiddlewareOptions>) => Promise<null | undefined>>;
        }[];
    };
};
/**
 * The link request without Turnstile keys: refused (503 TURNSTILE_NOT_SET), unless the site set
 * `turnstile: "off-until-keys"`, which lets it through with a warning line each time.
 * @param {boolean} offUntilKeys
 */
export function noTurnstile(offUntilKeys: boolean): {
    id: string;
    hooks: {
        before: {
            /** @param {{ path?: string }} ctx */
            matcher: (ctx: {
                path?: string;
            }) => boolean;
            handler: import("better-call").Middleware<import("better-call").MiddlewareOptions, (inputContext: import("better-call").MiddlewareInputContext<import("better-call").MiddlewareOptions>) => Promise<void>>;
        }[];
    };
};
export namespace NO_DISPOSABLE {
    let id: string;
    function init(): {
        options: {
            databaseHooks: {
                user: {
                    create: {
                        before: typeof refuseDisposable;
                    };
                };
            };
        };
    };
    namespace hooks {
        let before: {
            /** @param {{ path?: string }} ctx */
            matcher: (ctx: {
                path?: string;
            }) => boolean;
            handler: import("better-call").Middleware<import("better-call").MiddlewareOptions, (inputContext: import("better-call").MiddlewareInputContext<import("better-call").MiddlewareOptions>) => Promise<void>>;
        }[];
    }
}
export namespace SIGN_OUT_CLEARS {
    let id_1: string;
    export { id_1 as id };
    export namespace hooks_1 {
        let after: {
            /** @param {{ path?: string }} ctx */
            matcher: (ctx: {
                path?: string;
            }) => boolean;
            handler: import("better-call").Middleware<import("better-call").MiddlewareOptions, (inputContext: import("better-call").MiddlewareInputContext<import("better-call").MiddlewareOptions>) => Promise<void>>;
        }[];
    }
    export { hooks_1 as hooks };
}
/**
 * The session columns `sessionDetails` writes (SESSION_DETAILS_SQL). Neither is taken from a client; the device id is
 * never sent to one, since it is the cookie's value.
 */
export const SESSION_FIELDS: Readonly<{
    location: Readonly<{
        type: "string";
        required: false;
        input: false;
    }>;
    deviceId: Readonly<{
        type: "string";
        required: false;
        input: false;
        returned: false;
    }>;
}>;
import { refuseDisposable } from "./sign-in-disposable.mjs";
