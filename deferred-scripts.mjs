/**
 * Hydrate on intent, the React half (the browser half is ./hydrate-on-intent). Put `<HydrationScripts deferred={…} />`
 * where the root Layout had `<ScrollRestoration />` and `<Scripts />`, and `<StreamBuffer deferred={…} />` in the head.
 *
 * - Not deferred: React Router's own `<ScrollRestoration />` and `<Scripts />`, as on any page.
 * - Deferred: no module preloads and no boot scripts. React Router's boot goes into the page as JSON (a
 *   `<script type="application/json">`, which a browser never runs), and `hydrateNow()` or `hydrateOnIntent()` runs it
 *   from the page's own script. Nothing is held as markup or script text, so nothing needs a Trusted Types policy
 *   (the earlier way, held scripts in a <noscript>, needed innerHTML and a script-text policy). The import map that
 *   subresource integrity needs stays in the page, since it must be there before any module loads, and it loads none.
 *   ScrollRestoration mounts once the page has hydrated.
 *
 * Either way it marks <html> once the app is live (HYDRATED_ATTRIBUTE and HYDRATED_EVENT, ./hydrate-on-intent). Its
 * effect runs after the rest of the page's, so the app is ready when the press is handed on.
 *
 * Which pages defer is the site's choice (`routeHydrates` reads a route's `handle = { hydrate: true }`); decide it once per document, on the server and at hydration, and keep it for
 * the client-side navigations that follow (the boot is one tree, never remounted). The JSON mirrors what React Router
 * 8.5's `<Scripts>` writes (its context, the route modules per match, the manifest, the entry and the preloads); a
 * React Router upgrade checks it against that component. Needs `react` and `react-router`, which a React site has.
 */
import { Fragment, createElement as h, useContext, useEffect, useSyncExternalStore } from "react";
import {
  Scripts,
  ScrollRestoration,
  UNSAFE_DataRouterContext,
  UNSAFE_DataRouterStateContext,
  UNSAFE_FrameworkContext,
} from "react-router";
import { HOLDER_ID, STREAM_BUFFER_SCRIPT, markHydrated } from "./hydrate-on-intent.mjs";

/**
 * True when a matched route hydrates on load: its `handle.hydrate` is true, or a function of its loader data that
 * returns true. Every other page can defer. Pass `useMatches()`.
 * @param {readonly { handle?: unknown, loaderData?: unknown }[]} matches
 */
export function routeHydrates(matches) {
  return matches.some((match) => {
    const hydrate =
      /** @type {{ hydrate?: boolean | ((data: unknown) => boolean) } | undefined} */ (match.handle)
        ?.hydrate;
    return typeof hydrate === "function" ? hydrate(match.loaderData) : hydrate === true;
  });
}

const IMPORT_MAP_ID = "hydrate-on-intent-import-map";

const ESCAPES = /** @type {Record<string, string>} */ ({
  "&": "\\u0026",
  ">": "\\u003e",
  "<": "\\u003c",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
});

/** JSON that is safe inside a <script> element: no "<", ">" or "&" (React Router's own escaping). */
export function scriptJson(/** @type {unknown} */ value) {
  return JSON.stringify(value).replace(/[&><\u2028\u2029]/g, (c) => ESCAPES[c] ?? c);
}

/**
 * The route ids of the manifest a lazily discovered app starts with: the matched routes and those of every parent
 * path (React Router's getPartialManifest).
 * @param {{ state: { matches: { route: { id: string } }[], location: { pathname: string } },
 *   match?: (path: string) => { route: { id: string } }[] | null }} router
 */
function partialRouteIds(router) {
  const ids = new Set(router.state.matches.map((m) => m.route.id));
  const segments = router.state.location.pathname.split("/").filter(Boolean);
  const paths = ["/"];
  segments.pop();
  while (segments.length > 0) {
    paths.push(`/${segments.join("/")}`);
    segments.pop();
  }
  for (const path of paths) for (const m of router.match?.(path) ?? []) ids.add(m.route.id);
  return [...ids];
}

/**
 * The boot JSON's text: what React Router's `<Scripts>` would have run, as data. Exported for the test.
 * @param {{
 *   manifest: any,
 *   serverHandoffString?: string,
 *   lazy: boolean,
 *   router: any,
 *   matches: { route: { id: string } }[],
 * }} input
 */
export function bootJson({ manifest, serverHandoffString, lazy, router, matches }) {
  const sri = typeof manifest.sri === "object" && manifest.sri ? manifest.sri : {};
  const routes = matches.map(({ route }) => {
    const entry = manifest.routes[route.id];
    if (!entry) throw new Error(`Route ${route.id} not found in manifest`);
    return {
      id: route.id,
      modules: [
        entry.clientActionModule,
        entry.clientLoaderModule,
        entry.clientMiddlewareModule,
        entry.hydrateFallbackModule,
        entry.module,
      ].filter(Boolean),
    };
  });
  const hrefs = new Set([
    ...(lazy ? [] : [manifest.url]),
    manifest.entry.module,
    ...manifest.entry.imports,
    ...matches.flatMap(({ route }) => {
      const r = manifest.routes[route.id];
      return [
        r.module,
        r.clientActionModule,
        r.clientLoaderModule,
        r.hydrateFallbackModule,
        ...(r.imports ?? []),
      ].filter(Boolean);
    }),
  ]);
  let partial = null;
  if (lazy) {
    const { sri: hasSri, ...rest } = manifest;
    partial = {
      ...rest,
      routes: Object.fromEntries(partialRouteIds(router).map((id) => [id, manifest.routes[id]])),
      sri: hasSri ? true : undefined,
    };
  }
  const boot = {
    hmr: manifest.hmr?.runtime ?? null,
    manifestUrl: lazy ? null : manifest.url,
    manifest: partial,
    routes,
    entry: manifest.entry.module,
    preloads: [...hrefs].map((href) => (sri[href] ? { href, integrity: sri[href] } : { href })),
  };
  // The handoff string is React Router's, already JSON and escaped the same way.
  const body = scriptJson(boot);
  return `{"context":${serverHandoffString || "null"},${body.slice(1)}`;
}

const isServer = typeof document === "undefined";
/** @type {Map<string, string>} */
const pageText = new Map();
/** The server's text of one of these elements, read once in the browser so hydration renders it unchanged. */
function serverText(/** @type {string} */ id) {
  if (isServer) return "";
  if (!pageText.has(id)) pageText.set(id, document.getElementById(id)?.textContent ?? "");
  return pageText.get(id) ?? "";
}

const noSubscribe = () => () => {};
const useIsHydrated = () =>
  useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );

/** The boot as JSON, and the import map integrity needs, in place of React Router's scripts. */
function DeferredBoot() {
  const framework = useContext(UNSAFE_FrameworkContext);
  const dataRouter = useContext(UNSAFE_DataRouterContext);
  const state = useContext(UNSAFE_DataRouterStateContext);
  const nonce = framework?.nonce;
  let text = serverText(HOLDER_ID);
  let importMap = serverText(IMPORT_MAP_ID);
  if (isServer && framework && dataRouter && state) {
    // React Router streams the loader data only once a document has rendered its scripts.
    if (framework.renderMeta) framework.renderMeta.didRenderScripts = true;
    const { manifest } = framework;
    text = bootJson({
      manifest,
      serverHandoffString: dataRouter.staticContext ? framework.serverHandoffString : undefined,
      lazy: framework.routeDiscovery?.mode === "lazy" && framework.ssr,
      router: dataRouter.router,
      matches: state.matches,
    });
    if (typeof manifest.sri === "object" && manifest.sri)
      importMap = scriptJson({ integrity: manifest.sri });
  }
  return h(
    Fragment,
    null,
    importMap
      ? h("script", {
          id: IMPORT_MAP_ID,
          "rr-importmap": "",
          type: "importmap",
          nonce,
          suppressHydrationWarning: true,
          dangerouslySetInnerHTML: { __html: importMap },
        })
      : null,
    h("script", {
      id: HOLDER_ID,
      type: "application/json",
      nonce,
      suppressHydrationWarning: true,
      dangerouslySetInnerHTML: { __html: text },
    }),
  );
}

/**
 * React Router's scripts, or on a deferred page its boot as JSON. Marks the page hydrated once the app is live.
 * @param {{ deferred: boolean }} props
 */
export function HydrationScripts({ deferred }) {
  const hydrated = useIsHydrated();
  // A SPA-mode render has no server data to hand over; it boots as usual.
  const spa = useContext(UNSAFE_FrameworkContext)?.isSpaMode;
  useEffect(markHydrated, []);
  if (!deferred || spa) return h(Fragment, null, h(ScrollRestoration), h(Scripts));
  return h(Fragment, null, h(DeferredBoot), hydrated ? h(ScrollRestoration) : null);
}

/**
 * The head's stand-in for React Router's stream on a deferred page (STREAM_BUFFER_SCRIPT); nothing on any other page.
 * @param {{ deferred: boolean }} props
 */
export function StreamBuffer({ deferred }) {
  const nonce = useContext(UNSAFE_FrameworkContext)?.nonce;
  if (!deferred) return null;
  return h("script", {
    nonce,
    suppressHydrationWarning: true,
    dangerouslySetInnerHTML: { __html: STREAM_BUFFER_SCRIPT },
  });
}
