/**
 * Builds the entry's default export. `nonce` replaces how the nonce is read from the load context (default: ./context's
 * getNonce), for a renderer that stores a page under a placeholder nonce it renews per reader.
 * @param {{ nonce?: (context: Readonly<import("react-router").RouterContextProvider>) => string | undefined }} [options]
 */
export function reactEntry({ nonce: readNonce }?: {
    nonce?: (context: Readonly<import("react-router").RouterContextProvider>) => string | undefined;
}): (request: Request, status: number, headers: Headers, routerContext: import("react-router").EntryContext, loadContext: Readonly<import("react-router").RouterContextProvider>) => Promise<Response>;
export { handleServerError as handleError } from "./log.mjs";
/** How long React Router waits on a pending promise before rejecting it (ms); the render stops a second later. */
export const streamTimeout: 5000;
declare function _default(request: Request, status: number, headers: Headers, routerContext: import("react-router").EntryContext, loadContext: Readonly<import("react-router").RouterContextProvider>): Promise<Response>;
export default _default;
export type HandleRequest = (request: Request, status: number, headers: Headers, routerContext: EntryContext, loadContext: Readonly<RouterContextProvider>) => Promise<Response>;
import type { EntryContext } from "react-router";
import type { RouterContextProvider } from "react-router";
