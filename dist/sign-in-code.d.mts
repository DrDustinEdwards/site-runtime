/**
 * The code works only in the browser that asked for it (see the top of this file). After a request that mailed a
 * sign-in code, the binding is made; before a typed code is read, it is checked; after a sign-in by code, it is spent.
 */
export function codeBrowser(): {
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
            /** @param {{ path?: string, body?: { type?: unknown } }} ctx */
            matcher: (ctx: {
                path?: string;
                body?: {
                    type?: unknown;
                };
            }) => boolean;
            handler: import("better-call").Middleware<import("better-call").MiddlewareOptions, (inputContext: import("better-call").MiddlewareInputContext<import("better-call").MiddlewareOptions>) => Promise<void>>;
        }[];
    };
};
