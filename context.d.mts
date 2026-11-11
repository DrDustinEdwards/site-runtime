import type { RouterContext, RouterContextProvider } from "react-router";

/** The bindings and execution context of one request; `Env` is the site's own (wrangler types). */
export type CloudflareContext = { env: Env; ctx: ExecutionContext };
export const cloudflareContext: RouterContext<CloudflareContext>;
/** This render's Content-Security-Policy nonce; null where none is issued. Read it with getNonce. */
export const cspNonceContext: RouterContext<string | null>;
/** This render's Server-Timing marks; null outside a timed render. Read it with getTimings. */
export const serverTimingContext: RouterContext<import("./server-timing.mjs").Mark[] | null>;
export function getEnv(context: Readonly<RouterContextProvider>): Env;
export function getExecutionContext(context: Readonly<RouterContextProvider>): ExecutionContext;
export function getNonce(context: Readonly<RouterContextProvider>): string | undefined;
export function getTimings(
  context: Readonly<RouterContextProvider>,
): import("./server-timing.mjs").Mark[] | undefined;
