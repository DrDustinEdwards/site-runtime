/**
 * The per-request Cloudflare bindings and the render's Content-Security-Policy nonce, on React Router's context, once.
 * Seven sites each declared `cloudflareContext`, `getEnv` and a nonce context of their own, under two names for the
 * nonce. The Worker sets them before the render (`context.set(cloudflareContext, { env, ctx })`); loaders, actions and
 * middleware read the bindings through getEnv, so they never become a free-floating global and never reach the client.
 *
 * The one module here that needs `react-router` (a site that imports it has it; it is not declared as a dependency, as
 * for ./sign-in and better-auth).
 */
import { createContext } from "react-router";

/** The bindings and execution context of this request. */
export const cloudflareContext = createContext();

/**
 * This render's nonce: the same value goes in the header and on every inline <script>. The default is null, not
 * undefined: React Router throws "No value found for context" for an unset context whose default is undefined, and a
 * render path that never sets the nonce (a cached page, a static route) then answers 500. Read it with getNonce.
 */
export const cspNonceContext = createContext(/** @type {string | null} */ (null));

/**
 * This render's Server-Timing marks (./server-timing): a loader adds its own with `timed(getTimings(context), ...)`,
 * and they go out in the page's one Server-Timing header beside `render`. Null outside a timed render.
 */
export const serverTimingContext = createContext(
  /** @type {import("./server-timing.mjs").Mark[] | null} */ (null),
);

/** @param {Readonly<import("react-router").RouterContextProvider>} context */
export const getEnv = (context) => context.get(cloudflareContext).env;

/** @param {Readonly<import("react-router").RouterContextProvider>} context */
export const getExecutionContext = (context) => context.get(cloudflareContext).ctx;

/** @param {Readonly<import("react-router").RouterContextProvider>} context */
export const getNonce = (context) => context.get(cspNonceContext) ?? undefined;

/** @param {Readonly<import("react-router").RouterContextProvider>} context */
export const getTimings = (context) => context.get(serverTimingContext) ?? undefined;
