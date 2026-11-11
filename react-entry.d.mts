import type { EntryContext, RouterContextProvider } from "react-router";

export { handleServerError as handleError } from "./log.mjs";

/** How long React Router waits on a pending promise before rejecting it (ms); the render stops a second later. */
export const streamTimeout: number;

export type HandleRequest = (
  request: Request,
  status: number,
  headers: Headers,
  routerContext: EntryContext,
  loadContext: Readonly<RouterContextProvider>,
) => Promise<Response>;

/** Builds the entry's default export; `nonce` replaces how the nonce is read from the load context. */
export function reactEntry(options?: {
  nonce?: (context: Readonly<RouterContextProvider>) => string | undefined;
}): HandleRequest;

/** The entry with the standard nonce (./context's getNonce). */
declare const handleRequest: HandleRequest;
export default handleRequest;
