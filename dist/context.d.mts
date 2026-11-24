/**
 * The bindings and execution context of one request; `Env` is the site's own (wrangler types).
 * @typedef {object} CloudflareContext
 * @property {Env} env
 * @property {ExecutionContext} ctx
 */
/**
 * The bindings and execution context of this request.
 * @type {import("react-router").RouterContext<CloudflareContext>}
 */
export const cloudflareContext: import("react-router").RouterContext<CloudflareContext>;
/**
 * This render's nonce: the same value goes in the header and on every inline <script>. The default is null, not
 * undefined: React Router throws "No value found for context" for an unset context whose default is undefined, and a
 * render path that never sets the nonce (a cached page, a static route) then answers 500. Read it with getNonce.
 */
export const cspNonceContext: import("react-router").RouterContext<string | null>;
/**
 * This render's Server-Timing marks (./server-timing): a loader adds its own with `timed(getTimings(context), ...)`,
 * and they go out in the page's one Server-Timing header beside `render`. Null outside a timed render.
 */
export const serverTimingContext: import("react-router").RouterContext<import("./server-timing.mjs").Mark[] | null>;
export function previewContext<T>(): import("react-router").RouterContext<T | null>;
export function getEnv(context: Readonly<import("react-router").RouterContextProvider>): Env;
export function getExecutionContext(context: Readonly<import("react-router").RouterContextProvider>): ExecutionContext<any>;
export function getNonce(context: Readonly<import("react-router").RouterContextProvider>): string | undefined;
export function getTimings(context: Readonly<import("react-router").RouterContextProvider>): import("./server-timing.mjs").Mark[] | undefined;
/**
 * The bindings and execution context of one request; `Env` is the site's own (wrangler types).
 */
export type CloudflareContext = {
    env: Env;
    ctx: ExecutionContext;
};
