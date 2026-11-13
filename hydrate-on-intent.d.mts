/** Hydrate on intent, the browser half: run a deferred page's React Router boot when the reader reaches for the app. */

/** The id of the <script type="application/json"> that holds a deferred page's boot. */
export const HOLDER_ID: "hydrate-on-intent";
/** Set on <html> once the app has hydrated. */
export const HYDRATED_ATTRIBUTE: "data-hydrated";
/** Dispatched on `document` once the app has hydrated. */
export const HYDRATED_EVENT: "site-runtime:hydrated";
/** Where the head's stand-in keeps the streamed loader data. */
export const STREAM_BUFFER: "__siteRuntimeStream";
/** The head's stand-in for React Router's stream on a deferred page. */
export const STREAM_BUFFER_SCRIPT: string;

/** True on a page whose React waits for intent. */
export function isDeferred(): boolean;
/** True once the app is live on this page. */
export function isHydrated(): boolean;
/** Marks <html> and dispatches HYDRATED_EVENT; ./deferred-scripts calls it. */
export function markHydrated(): void;
/** Runs the deferred boot now; the same promise on every call until one fails, then a fresh try. Resolves once the client entry has loaded. */
export function hydrateNow(): Promise<void>;
/**
 * Hydrates on the first press, hover or focus of a control matching `selector`, and hands the press on once the app is
 * live. `press` runs inside the press (return false when it needs no app); `warm` on hover or focus. False on a page
 * that hydrates on load.
 */
export function hydrateOnIntent(options: {
  selector: string;
  press?: (control: HTMLElement) => boolean;
  warm?: (control: HTMLElement) => void;
}): boolean;
