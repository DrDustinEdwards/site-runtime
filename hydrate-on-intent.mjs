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
export const HOLDER_ID = "hydrate-on-intent";

/** The attribute ./deferred-scripts sets on <html> once the app has hydrated, and the event it dispatches on `document`. */
export const HYDRATED_ATTRIBUTE = "data-hydrated";
export const HYDRATED_EVENT = "site-runtime:hydrated";

/** Where the stand-in below keeps the streamed loader data until React Router's own stream exists. */
export const STREAM_BUFFER = "__siteRuntimeStream";

/**
 * React Router streams a page's loader data after the document as inline scripts that call
 * `window.__reactRouterContext.streamController`, which its boot creates. On a deferred page the boot has not run, so
 * this script, inline in the head under the page's nonce, stands in and keeps each chunk; `hydrateNow` hands them over.
 * Fixed text with no "<", so the network's default policy would pass it even as a string.
 */
export const STREAM_BUFFER_SCRIPT = `window.${STREAM_BUFFER}={chunks:[],closed:false};window.__reactRouterContext={streamController:{enqueue:function(c){window.${STREAM_BUFFER}.chunks.push(c)},close:function(){window.${STREAM_BUFFER}.closed=true}}};`;

// React Router's sessionStorage key for its saved scroll positions (ScrollRestoration).
const SCROLL_POSITIONS = "react-router-scroll-positions";

/** True on a page whose React waits for intent. */
export function isDeferred() {
  return document.getElementById(HOLDER_ID) !== null;
}

/** True once the app is live on this page. */
export function isHydrated() {
  return document.documentElement.hasAttribute(HYDRATED_ATTRIBUTE);
}

/** Called once the app has hydrated (./deferred-scripts does it): marks <html> and tells the page. */
export function markHydrated() {
  if (isHydrated()) return;
  document.documentElement.setAttribute(HYDRATED_ATTRIBUTE, "");
  document.dispatchEvent(new Event(HYDRATED_EVENT));
}

/**
 * The page's position is where the reader is now: ScrollRestoration, mounting as the page hydrates, would otherwise
 * restore one saved for this history entry on an earlier visit and move the page under the reader's hand.
 */
function forgetSavedScroll() {
  try {
    const saved = sessionStorage.getItem(SCROLL_POSITIONS);
    if (!saved) return;
    const positions = /** @type {Record<string, number>} */ (JSON.parse(saved));
    delete positions[/** @type {{ key?: string } | null} */ (history.state)?.key ?? "default"];
    sessionStorage.setItem(SCROLL_POSITIONS, JSON.stringify(positions));
  } catch {
    /* storage blocked: nothing was saved either */
  }
}

/**
 * @typedef {{
 *   context: Record<string, unknown> | null,
 *   hmr: string | null,
 *   manifestUrl: string | null,
 *   manifest: Record<string, unknown> | null,
 *   routes: { id: string, modules: string[] }[],
 *   entry: string,
 *   preloads: { href: string, integrity?: string }[],
 * }} Boot
 */

/**
 * Makes React Router's context as its boot script would, and hands it the loader data the page streamed meanwhile.
 * @param {Record<string, unknown>} context the server handoff
 */
function startContext(context) {
  const w = /** @type {Record<string, any>} */ (/** @type {unknown} */ (window));
  /** @type {{ chunks: string[], closed: boolean } | undefined} */
  const buffer = w[STREAM_BUFFER];
  /** @type {ReadableStreamDefaultController<string> | undefined} */
  let controller;
  context.stream = new ReadableStream({
    start(c) {
      controller = c;
    },
  }).pipeThrough(new TextEncoderStream());
  context.streamController = controller;
  // From here the page's streamed scripts, still arriving, write to the real stream.
  w.__reactRouterContext = context;
  if (!buffer || !controller) return;
  for (const chunk of buffer.chunks) controller.enqueue(chunk);
  if (buffer.closed) controller.close();
}

/** @type {Promise<void> | null} */
let running = null;

/**
 * Runs the page's React Router boot now: the module preloads, the context and its stream, the route modules, then the
 * client entry, which hydrates the page. Resolves once the entry has loaded (hydration follows; wait for
 * HYDRATED_EVENT for the app). Calling it again returns the same promise; on a page that hydrates on load it does
 * nothing.
 * @returns {Promise<void>}
 */
export function hydrateNow() {
  if (running) return running;
  const holder = document.getElementById(HOLDER_ID);
  if (!holder || isHydrated()) return Promise.resolve();
  forgetSavedScroll();
  const boot = /** @type {Boot} */ (JSON.parse(holder.textContent ?? "{}"));
  const nonce = /** @type {HTMLScriptElement} */ (holder).nonce;
  for (const { href, integrity } of boot.preloads) {
    const link = document.createElement("link");
    link.rel = "modulepreload";
    link.href = href;
    if (integrity) link.integrity = integrity;
    if (nonce) link.nonce = nonce;
    document.head.appendChild(link);
  }
  if (boot.context) startContext(boot.context);
  const w = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (window));
  if (boot.manifest) w.__reactRouterManifest = boot.manifest;
  const load = (/** @type {string} */ url) => import(/* @vite-ignore */ url);
  running = (async () => {
    // In the order React Router's module script imports them: the HMR runtime, the manifest, then the routes.
    if (boot.hmr) await load(boot.hmr);
    if (boot.manifestUrl) await load(boot.manifestUrl);
    const modules = await Promise.all(
      boot.routes.map(async ({ modules: urls }) => {
        const chunks = await Promise.all(urls.map(load));
        return chunks.length === 1 ? chunks[0] : Object.assign({}, ...chunks);
      }),
    );
    w.__reactRouterRouteModules = Object.fromEntries(
      boot.routes.map(({ id }, index) => [id, modules[index]]),
    );
    await load(boot.entry);
  })();
  running.catch((error) => console.error("hydrate-on-intent: the app did not load", error));
  return running;
}

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
 * had it, then a click. Returns false on a page that hydrates on load, where nothing is listened for.
 * @param {{ selector: string, press?: (control: HTMLElement) => boolean, warm?: (control: HTMLElement) => void }} options
 */
export function hydrateOnIntent({ selector, press, warm }) {
  if (!isDeferred() || isHydrated()) return false;
  /** @type {{ index: number, focused: boolean } | null} */
  let pending = null;
  const control = (/** @type {Event} */ event) =>
    !isHydrated() && event.target instanceof Element ? event.target.closest(selector) : null;
  document.addEventListener(
    "click",
    (event) => {
      const found = control(event);
      if (!(found instanceof HTMLElement)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      pending =
        (press?.(found) ?? true)
          ? {
              index: Array.from(document.querySelectorAll(selector)).indexOf(found),
              focused: document.activeElement === found,
            }
          : null;
      void hydrateNow();
    },
    true,
  );
  const ready = (/** @type {Event} */ event) => {
    const found = control(event);
    if (!(found instanceof HTMLElement)) return;
    warm?.(found);
    void hydrateNow();
  };
  document.addEventListener("pointerover", ready);
  document.addEventListener("focusin", ready);
  document.addEventListener(
    HYDRATED_EVENT,
    () => {
      if (!pending) return;
      const { index, focused } = pending;
      pending = null;
      // Found again by position: hydration keeps the server's elements, but a render it had to redo would not.
      const again = document.querySelectorAll(selector)[index];
      if (!(again instanceof HTMLElement)) return;
      if (focused) again.focus();
      again.click();
    },
    { once: true },
  );
  return true;
}
