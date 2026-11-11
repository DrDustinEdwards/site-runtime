/**
 * The one React Router server entry every site's app/entry.server.tsx re-exports, so each page is rendered the same
 * way on every site: nine sites each had their own copy, some streaming, some waiting for the whole page, some logging
 * a render error and some not.
 *
 * What it does, following React Router's own entry and React's guidance for crawlers:
 * - A HEAD request gets the status and headers with no render (the body would be thrown away).
 * - The page streams to people; a crawler (isbot) and an SPA-mode render wait for the whole document (`allReady`),
 *   so a crawler never indexes a fallback. A page with no Suspense boundary is one chunk either way.
 * - The request's CSP nonce (./context) goes on React's streamed scripts, on ServerRouter (and so on `<Scripts>` and
 *   `<ScrollRestoration>`) and into ./nonce's NonceContext for any inline script a component writes.
 * - The render stops at `streamTimeout` plus a second, or when the reader goes away (`request.signal`). React Router
 *   rejects pending promises at `streamTimeout`; the site re-exports it.
 * - A render error after the shell is one scrubbed `render_failed` line at error level with the request's fields
 *   (./log), and the status becomes 500; an error before the shell rejects, and React Router logs it through
 *   `handleError`, which is ./log's handleServerError (route 404s are counted by ./not-found, not logged).
 *
 * Needs `react`, `react-dom` and `react-router`, which a React site has (not declared, as for ./context).
 *
 * In app/entry.server.tsx:
 *   export { default, handleError, streamTimeout } from "@dustinedwards/site-runtime/react-entry";
 */
import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import { getNonce } from "./context.mjs";
import { logEvent, requestFields } from "./log.mjs";
import { NonceContext } from "./nonce.mjs";

export { handleServerError as handleError } from "./log.mjs";

/** How long React Router waits on a pending promise before rejecting it (ms); the render stops a second later. */
export const streamTimeout = 5_000;

/**
 * Builds the entry's default export. `nonce` replaces how the nonce is read from the load context (default: ./context's
 * getNonce), for a renderer that stores a page under a placeholder nonce it renews per reader.
 * @param {{ nonce?: (context: Readonly<import("react-router").RouterContextProvider>) => string | undefined }} [options]
 */
export function reactEntry({ nonce: readNonce = getNonce } = {}) {
  /**
   * @param {Request} request
   * @param {number} status
   * @param {Headers} headers
   * @param {import("react-router").EntryContext} routerContext
   * @param {Readonly<import("react-router").RouterContextProvider>} loadContext
   */
  return async function handleRequest(request, status, headers, routerContext, loadContext) {
    if (request.method === "HEAD") return new Response(null, { status, headers });
    const nonce = readNonce(loadContext);
    let shellRendered = false;
    const body = await renderToReadableStream(
      createElement(
        NonceContext.Provider,
        { value: nonce },
        createElement(ServerRouter, { context: routerContext, url: request.url, nonce }),
      ),
      {
        nonce,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(streamTimeout + 1_000)]),
        onError(error) {
          status = 500;
          // Before the shell, the render rejects and React Router logs it through handleError; a reader who left is no failure.
          if (shellRendered && !request.signal.aborted)
            logEvent("render_failed", { ...requestFields(request), error }, { level: "error" });
        },
      },
    );
    shellRendered = true;
    if (routerContext.isSpaMode || isbot(request.headers.get("user-agent") ?? ""))
      await body.allReady;
    headers.set("Content-Type", "text/html; charset=utf-8");
    return new Response(body, { headers, status });
  };
}

/** The entry with the standard nonce. */
export default reactEntry();
