/** True on a page whose React waits for intent. */
export function isDeferred(): boolean;
/** True once the app is live on this page. */
export function isHydrated(): boolean;
/** Called once the app has hydrated (./deferred-scripts does it): marks <html> and tells the page. */
export function markHydrated(): void;
/**
 * Runs the page's React Router boot now: the module preloads, the context and its stream, the route modules, then the
 * client entry, which hydrates the page. Resolves once the entry has loaded (hydration follows; wait for
 * HYDRATED_EVENT for the app). Calling it again returns the same promise, a failed one included: a browser keeps a module
 * that failed to load failed, and the loader-data stream cannot be started twice, so a boot is never retried (the
 * presses fall back to the page's own behavior instead, as hydrateOnIntent does). On a page that hydrates on load it
 * does nothing.
 * @returns {Promise<void>}
 */
export function hydrateNow(): Promise<void>;
/**
 * Hydrates the page on the first press of a control that needs the app, and hands the press to it once the app is
 * live. Pressing, hovering or focusing a control that matches `selector` starts the boot.
 *
 * - `press(control)` runs inside the press itself, before the app exists, for what cannot wait (Safari refuses a
 *   play() that comes later). Return false when the press is complete without the app (it paused what it started),
 *   and it is not handed on.
 * - `warm(control)` runs when a pointer rests on a control or the focus reaches one, to ready the press.
 *
 * The control is found again by its position among the matches once the app is live, and gets the focus back if it
 * had it, then a click. If the boot fails (a chunk that did not load on a flaky network), the press that was waiting
 * becomes a full page load (a link's own address, else this page again), and later presses are no longer intercepted,
 * so they do what the server's page does by itself. Returns false on a page that hydrates on load, where nothing is
 * listened for.
 * @param {{ selector: string, press?: (control: HTMLElement) => boolean, warm?: (control: HTMLElement) => void }} options
 */
export function hydrateOnIntent({ selector, press, warm }: {
    selector: string;
    press?: (control: HTMLElement) => boolean;
    warm?: (control: HTMLElement) => void;
}): boolean;
/**
 * Hydrate on intent, the browser half (the server half is ./deferred-scripts). A page that needs React only for one
 * thing, such as a player that keeps playing across client-side navigations, sends no React until the reader reaches
 * for that thing: React Router's boot waits on the page as JSON, and the first press of a control that needs the app
 * runs it. A pointer resting on such a control, or the focus reaching one, starts the work early. Once the app is live
 * the press is handed to its control, as if React had been there all along.
 *
 * Trusted Types safe by construction: nothing here writes markup or script text. The JSON is read, never run; the
 * route modules and the client entry load with `import()`, which no Trusted Types sink covers and which the page's
 * script-src governs as for any same-origin module; the module preloads are <link> elements with an href. So the page
 * needs no policy of its own beyond the network's (./trusted-types), and its CSP needs no new source.
 *
 * Browser-only, no dependencies. A page that hydrates on load has no JSON holder, and every function here stays out of
 * its way.
 */
/** The id of the <script type="application/json"> that holds a deferred page's boot. */
export const HOLDER_ID: "hydrate-on-intent";
/** The attribute ./deferred-scripts sets on <html> once the app has hydrated, and the event it dispatches on `document`. */
export const HYDRATED_ATTRIBUTE: "data-hydrated";
export const HYDRATED_EVENT: "site-runtime:hydrated";
/** Where the stand-in below keeps the streamed loader data until React Router's own stream exists. */
export const STREAM_BUFFER: "__siteRuntimeStream";
/**
 * React Router streams a page's loader data after the document as inline scripts that call
 * `window.__reactRouterContext.streamController`, which its boot creates. On a deferred page the boot has not run, so
 * this script, inline in the head under the page's nonce, stands in and keeps each chunk; `hydrateNow` hands them over.
 * Fixed text with no "<", so the network's default policy would pass it even as a string.
 */
export const STREAM_BUFFER_SCRIPT: "window.__siteRuntimeStream={chunks:[],closed:false};window.__reactRouterContext={streamController:{enqueue:function(c){window.__siteRuntimeStream.chunks.push(c)},close:function(){window.__siteRuntimeStream.closed=true}}};";
export type Boot = {
    context: Record<string, unknown> | null;
    hmr: string | null;
    manifestUrl: string | null;
    manifest: Record<string, unknown> | null;
    routes: {
        id: string;
        modules: string[];
    }[];
    entry: string;
    preloads: {
        href: string;
        integrity?: string;
    }[];
};
