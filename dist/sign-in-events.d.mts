/**
 * The auth event log and the security notices (`./sign-in-account.mjs`) as one plugin: an after hook on every endpoint,
 * and database hooks for what only the rows show (a linked or unlinked account's provider, both addresses of an email
 * change, a deleted user's address). Every hook catches its own errors, logged as `auth_event_failed`: a throw from an
 * after hook would turn a change already made into an error answer. A notice goes through Better Auth's
 * `runInBackgroundOrAwait`, so a site with `advanced.backgroundTasks` (waitUntil) answers before the mail is sent.
 * Its before hook holds passkey delete and email change to FRESH_SECONDS. A sign-in from a device the person's
 * sessions and history have not shown is told as `new-device`; a sign-in by link or code with no passkey left, by
 * someone whose history shows one, is a recovery: told, and every other session ended, as after an email change.
 * With `details` (`sessionDetails`) a new session gets its place and device id (database hook), a sign-in's row its
 * device id, and the new-device check reads device ids where the person has any (`isNewSignInDevice`).
 * @param {string} siteName
 * @param {SendSecurityNotice | undefined} sendSecurityNotice
 * @param {import("./sign-in-account.mjs").D1Like | null} db
 * @param {boolean} details
 */
export function accountEvents(siteName: string, sendSecurityNotice: SendSecurityNotice | undefined, db: import("./sign-in-account.mjs").D1Like | null, details: boolean): {
    id: string;
    init: () => {
        options: {
            databaseHooks: {
                account: {
                    create: {
                        after: (account: any, ctx: {
                            path?: string;
                            query?: Record<string, unknown>;
                            headers?: Headers;
                            request?: Request;
                            context?: any;
                        } | null | undefined) => Promise<void>;
                    };
                    delete: {
                        after: (account: any, ctx: {
                            path?: string;
                            query?: Record<string, unknown>;
                            headers?: Headers;
                            request?: Request;
                            context?: any;
                        } | null | undefined) => Promise<void>;
                    };
                };
                user: {
                    update: {
                        before: (data: any, ctx: {
                            path?: string;
                            query?: Record<string, unknown>;
                            headers?: Headers;
                            request?: Request;
                            context?: any;
                        } | null | undefined) => Promise<void>;
                        after: (user: any, ctx: {
                            path?: string;
                            query?: Record<string, unknown>;
                            headers?: Headers;
                            request?: Request;
                            context?: any;
                        } | null | undefined) => Promise<void>;
                    };
                    delete: {
                        after: (user: any, ctx: {
                            path?: string;
                            query?: Record<string, unknown>;
                            headers?: Headers;
                            request?: Request;
                            context?: any;
                        } | null | undefined) => Promise<void>;
                    };
                };
                session?: {
                    create: {
                        before: (session: any, ctx: any) => Promise<{
                            data: any;
                        }>;
                    };
                } | undefined;
            };
        };
    };
    hooks: {
        before: {
            /** @param {{ path?: string }} ctx */
            matcher: (ctx: {
                path?: string;
            }) => boolean;
            handler: import("better-call").Middleware<import("better-call").MiddlewareOptions, (inputContext: import("better-call").MiddlewareInputContext<import("better-call").MiddlewareOptions>) => Promise<void>>;
        }[];
        after: {
            matcher: () => boolean;
            handler: import("better-call").Middleware<import("better-call").MiddlewareOptions, (inputContext: import("better-call").MiddlewareInputContext<import("better-call").MiddlewareOptions>) => Promise<void>>;
        }[];
    };
};
export type SendSecurityNotice = import("./sign-in-account.mjs").SendSecurityNotice;
