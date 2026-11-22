/**
 * The one Worker every React Router site runs: the gateway, the Renderer the Workers cache stores pages from, the
 * request log around them and the cron handler. Nine sites each wrote their own (gateway map, 2026-11-11), with seven
 * rules for what may be stored, four keys for the CSP report limit and three answers to an unknown cron. A site now
 * names what is its own (its steps, its header set, its extra preloads) and gets the same behavior as every other.
 *
 * One behavior for each step the sites did differently, in the order the gateway runs them:
 *
 * 1. Canonical address (./url canonicalRedirect): first, before anything reads the request, so an http request never
 *    gets a policy whose report endpoint is http. The move carries the security set built for where it points.
 *    `canonical.before` is a site's own earlier move (dei's WordPress addresses), answered the same way, and
 *    `canonical.keep(url)` keeps an address's trailing slash (dei's removed WordPress addresses answer 410 as they were).
 * 2. Maintenance (./maintenance): every path but /health answers 503 while MAINTENANCE is on.
 * 3. /.well-known/security.txt (./security-txt, RFC 9116) on every site, with the network's contact.
 * 4. The standard files (Prelum's standardFiles: robots.txt, ai.txt, site.webmanifest, the IndexNow key, ownership
 *    files), when the site passes `files`.
 * 5. The speculation rules file (./prefetch), with the site's exclude list.
 * 6. CSP reports (./csp-report): limited per caller address (./http clientIp) through the CSP_REPORT_RATE_LIMIT binding;
 *    with no binding, or over the limit, a report is dropped (still 204).
 * 7. The operator API (./operator) at /api/operator, when the site passes `operator`.
 * 8. A cross-site write is refused (./origin refuseCrossSite) on every path but `crossSiteExempt` (default /api/auth/,
 *    where Better Auth checks its own origins and Apple's form_post arrives cross-site), before the steps, so an
 *    app's own cookie-authenticated API gets the check too. A bearer or server-to-server caller sends no Origin and
 *    no Sec-Fetch-Site, so it passes.
 * 9. The site's own steps (`steps`: its media files, Carrel's site API, an app's API), in order; the first answer wins.
 *    A step's answer gets the security set (a policy the answer carries itself is kept). A write a step accepts purges
 *    the stored pages when the step says so (`kit.purgeAfterWrite`).
 * 10. The page. A read (GET or HEAD) with no cookie but `publicCookies`, not refused by the site's `cacheable`, goes
 *     to the Renderer through the Workers cache (a file path too: a shared feed or sitemap is stored and purged like a
 *     page, and anything not shared leaves with an edge no-store, so the cache keeps nothing else), keyed on the path, the
 *     query without tracking parameters, the host and each public cookie's value. Everything else (a write, a signed-in
 *     reader, a private path) is rendered live for this reader with its own nonce, and leaves private, no-store unless
 *     the route said otherwise for a page that is not shared. A live write on a `purgeAfter` path (default /admin)
 *     purges the stored pages.
 *
 * Every render gets a nonce, which ./react-entry puts on React's scripts; a site whose policy names it (rather than
 * hashing its inline scripts) has it renewed per reader by the gateway (./csp renewNonce), so two readers of a stored
 * page never share one. A 304 from the cache leaves out the policy: RFC 9111 4.3.4 has the
 * browser update its stored headers from a 304, and a new nonce there would not match the scripts in its copy.
 *
 * On the way out, every HTML answer carries the Speculation-Rules header, a private page (./edge-cache
 * PRIVATE_PAGE_HEADERS, no-transform, so Cloudflare injects no beacon and compresses nothing) is compressed by the
 * Worker, a 404 is counted (./not-found) unless it is
 * under /api/ or /preview/, and a 404 goes through the site's `onNotFound` (site-api's tombstones, a 410). A gateway
 * that throws answers a plain 500 with the security set and logs `gateway_error`, never the runtime's 1101 page.
 *
 * A render whose route failed because D1 was down (a page, a .data request or a resource route) answers 503 with
 * Retry-After and no-store instead of React Router's 500 (./log databaseDownStatus).
 *
 * Around the gateway, outermost first: the request log (./log; the deployed commit from DEPLOY_SHA, a preview token cut
 * from the path, the route named from the React Router build, loaded and awaited inside the request, since a promise
 * left from a finished request can stay unsettled in workerd), the site's `wrap` (Prelum's markdownCopies), then the
 * admin idle sign-out (./access) for each of `adminIdle`.
 *
 * Under `vite dev` (mode "development") a page also carries `<meta property="csp-nonce">` for the styles Vite injects.
 *
 * Every render sets ./context serverTimingContext, so a loader's own marks join `render` in the Server-Timing header.
 * A page a route marks shared (`public, max-age=0`) with no edge lifetime of its own is stored for publicPageHeaders'
 * day, so the purge it answers to has something to reach. The cache rule is the routes' own `headers` and these steps,
 * the same on every site: no site hook rewrites an answer's Cache-Control.
 *
 * Cron: `cron(env, date, ctx)[controller.cron]` (the lists may come from a promise, so a site can import its jobs when
 * the cron fires) runs through ./cron runJobs, awaited; a trigger with no list warns
 * `cron_unknown` and runs nothing.
 *
 * In workers/app.ts:
 *   const site = defineSite({ ... });
 *   export class Renderer extends siteRenderer(WorkerEntrypoint, site) {}
 *   export default siteWorker(site);
 *
 * Needs `react-router` (a React site has it; not declared, as for ./context).
 */
import { createRequestHandler, RouterContextProvider } from "react-router";
import { withAdminIdle } from "./access.mjs";
import { cloudflareContext, cspNonceContext, serverTimingContext } from "./context.mjs";
import { CSP_REPORT_PATH, generateNonce, renewNonce } from "./csp.mjs";
import { receiveCspReport } from "./csp-report.mjs";
import { runJobs } from "./cron.mjs";
import {
  EDGE_CACHE_HEADER,
  SHARED_CACHE_CONTROL,
  cacheKey,
  compressUntransformed,
  forReader,
  forRenderer,
  privateRender,
  publicPageHeaders,
  purgeAfterWrite,
  settleCacheHeaders,
  stampValidator,
  withPurgePages,
} from "./edge-cache.mjs";
import { cookiePairs } from "./headers.mjs";
import { clientIp, isWrite, textResponse } from "./http.mjs";
import {
  databaseDownStatus,
  errorMessage,
  logEvent,
  routeNamer,
  scrubFields,
  tokenPattern,
  withRequestLog,
} from "./log.mjs";

import { maintenanceOn, maintenanceResponse } from "./maintenance.mjs";
import { countNotFound } from "./not-found.mjs";
import { operatorResponse } from "./operator.mjs";
import { refuseCrossSite } from "./origin.mjs";
import {
  SPECULATION_RULES_HEADER,
  SPECULATION_RULES_PATH,
  speculationRulesResponse,
} from "./prefetch.mjs";
import { pageStylesheets, preloads, withPreloadHeader } from "./preload.mjs";
import { securityTxtResponse } from "./security-txt.mjs";
import { timedRender } from "./server-timing.mjs";
import { canonicalRedirect } from "./url.mjs";
import { deployedSha } from "./deploy.mjs";
import { withSentryRequest, withSiteSentry } from "./sentry.mjs";

/** @import { ServerBuild } from "react-router" */

/** @import { CronJob } from "./cron.mjs" */

/** @import { OperatorTool } from "./operator.mjs" */

/** @import { Preconnect, Preload } from "./preload.mjs" */

/** @import { AccessSecrets, AdminSettings } from "./access.mjs" */

/**
 * The secrets and dashboard vars every site's Worker reads through site-runtime, which `wrangler types` cannot see. A
 * site's env.d.ts extends it (`interface Env extends SiteSecrets {}`) and adds only its own. Each is optional where the
 * code that reads it fails closed when it is unset.
 *
 * - `MAINTENANCE`: "1" or "true" puts the site in maintenance: every path but /health answers the 503 page (./maintenance).
 * - `ADMIN_IDLE_SECRET`: Keys the admin idle cookie (withAdminIdle `secret`). Minted by the deploy (devkit worker-deploy `generated-secrets`).
 * - `OPERATOR_TOKEN`: The bearer for /api/operator (./operator), 32 characters or more. Unset or short: the route answers 503.
 * - `CARREL_SITE_KEY`: Carrel's key for site-api's /api/carrel/v1, 32 characters or more. Unset or short: every call is refused.
 * - `ANTHROPIC_API_KEY`: The Anthropic key for the site's AI features (straight at Anthropic). Unset: those features say so.
 * - `TURNSTILE_SITE_KEY`: Turnstile on the sign-in email link (./sign-in). On only when both are set.
 * @typedef {AdminSettings & Partial<AccessSecrets> & { MAINTENANCE?: string; ADMIN_IDLE_SECRET: string; OPERATOR_TOKEN?: string; CARREL_SITE_KEY?: string; ANTHROPIC_API_KEY?: string; TURNSTILE_SITE_KEY?: string; TURNSTILE_SECRET_KEY?: string; }} SiteSecrets
 */

/**
 * What a site step gets beside the request.
 *
 * - `render`: The page's route rendered in-process (a Carrel preview), with `nonce` and any extra context `set`.
 * - `stylesheets`: The page stylesheet hrefs (the root's and `stylesheetRoutes`'), for a preview drawn outside React Router.
 * - `purgeAfterWrite`: Purges the stored pages once a write it accepted has answered 2xx.
 * - `secure`: The site's security set on `response`.
 * @typedef {{ url: URL; render(request: Request, extra?: RenderExtra): Promise<Response>; stylesheets(): Promise<string[]>; purgeAfterWrite(request: Request, response: Response, why: string): void; secure(response: Response, request?: Request, nonce?: string): Response; }} GatewayKit
 */

/**
 * @typedef {object} RenderExtra
 * @property {string} [nonce]
 * @property {(context: RouterContextProvider) => void} [set] Sets the site's own context keys for this one render (a preview's page).
 */

/**
 * A site step: answers the request, or undefined to pass it on. The answer gets the security set (a policy it carries
 * itself is kept).
 * @template E
 * @typedef {(
 * request: Request,
 * env: E,
 * ctx: ExecutionContext,
 * kit: GatewayKit,
 * ) => Response | undefined | null | Promise<Response | undefined | null>} GatewayStep
 */

/**
 * @template E
 * @typedef {(
 * request: Request,
 * env: E,
 * ctx: ExecutionContext,
 * ) => Promise<Response>} FetchHandler
 */

/**
 * @template E
 * @typedef {object} SiteOptions
 * @property {string} name The site's name on the maintenance page.
 * @property {() => Promise<ServerBuild>} serverBuild `() => import("virtual:react-router/server-build")`.
 * @property {string} [mode] `import.meta.env.MODE`.
 * @property {(response: Response, request: Request, nonce?: string, env?: E) => Response} withSecurityHeaders The site's security set: pageSecurity's withSecurityHeaders.
 * @property {| false | { host?: string; except?: string[]; before?: ( request: Request, env: E, ) => Response | null | undefined | Promise<Response | null | undefined>; keep?: (url: URL) => boolean; }} [canonical] canonicalRedirect's options (`host`, `except`), plus `before`, a site's own earlier move, and `keep`, a test for an address whose slash stays; false for none.
 * @property {(request: Request, env: E) => Promise<Response | null> | Response | null} [files] Prelum's standardFiles handler (robots.txt, ai.txt, site.webmanifest, IndexNow key, ownership files).
 * @property {string[]} [speculationExclude] Paths the hover prefetch never fetches, beyond NEVER_PREFETCH.
 * @property {(env: E, ctx: ExecutionContext) => Record<string, OperatorTool>} [operator] The operator API's tools, served at /api/operator behind OPERATOR_TOKEN and RATE_LIMITER.
 * @property {GatewayStep<E>[]} [steps] The site's own steps, in order, after the cross-site check and before the page.
 * @property {string[]} [crossSiteExempt] Path prefixes a cross-site write may reach (default ["/api/auth/"]).
 * @property {string[]} [purgeAfter] Path prefixes whose accepted live writes purge the stored pages (default ["/admin"]).
 * @property {string[]} [publicCookies] Cookies that change nothing private; their values join the cache key (a theme).
 * @property {(request: Request, url: URL, env: E) => boolean} [cacheable] False keeps a read from the Renderer (a private path, a signed-in-only area); the standard rule applies first.
 * @property {( url: URL, env: E, ) => Promise<Parameters<typeof import("./edge-cache.mjs").publicPageHeaders>[0]>} [publicPages] For a site whose routes name no Cache-Control: a 200 the Renderer draws without one is stored, under these tags (publicPageHeaders' options: `tags`, `until`). A route's own Cache-Control is left alone.
 * @property {(Preload | Preconnect)[]} [preloads] Preloads beyond the page stylesheets, for the Early Hints header (fonts).
 * @property {readonly string[]} [stylesheetRoutes] Route ids beyond the root whose stylesheets every page loads, such as a layout's ("routes/_site"): they join the root's in the Early Hints header and in `stylesheets()`, which a preview drawn outside React Router reads.
 * @property {(context: RouterContextProvider, env: E, ctx: ExecutionContext) => void} [context] Sets the site's own context keys on every render. cloudflareContext and cspNonceContext are set already.
 * @property {(env: E) => Parameters<typeof import("./edge-cache.mjs").recordPurge>[0]} [purgeKv] The KV that keeps the last failed purge, for purgeCheck.
 * @property {(response: Response, request: Request, env: E) => Response | Promise<Response>} [onNotFound] A 404's last word: site-api's tombstoned, a 410 for a path Carrel removed.
 * @property {( env: E, ) => Parameters<typeof import("./not-found.mjs").countNotFound>[0] | undefined} [notFoundDb] Where 404s are counted; default env.DB.
 * @property {(handler: FetchHandler<E>) => FetchHandler<E>} [wrap] Wraps the gateway inside the request log: Prelum's markdownCopies.
 * @property {{ prefixes?: string[]; cookieName?: string; secret: (env: E) => string }[]} [adminIdle] Admin idle sign-outs (./access withAdminIdle), outermost first.
 * @property {( env: E, scheduledTime: Date, ctx: ExecutionContext, ) => Record<string, CronJob[] | undefined> | Promise<Record<string, CronJob[] | undefined>>} [cron] The job lists by cron expression, for the firing at `scheduledTime`.
 * @property {(env: E) => string | undefined} [sha] The deployed commit; default env.DEPLOY_SHA.
 * @property {readonly string[]} [tokenRoutes] The site's token routes beside /preview/, as path prefixes without slashes ("u", "e/c"): the token after one is cut from the request log and from CSP reports (a report names the page it came from).
 * @property {(path: string) => string | undefined} [routeName] Log route names for paths a site step answers.
 */

/**
 * @template E
 * @typedef {object} Site
 * @property {SiteOptions<E>} options
 * @property {(request: Request, env: E, ctx: ExecutionContext, extra?: RenderExtra) => Promise<Response>} render
 * @property {(request: Request, env: E) => Promise<string | null>} renderHtml A page's HTML as the Renderer would render it, with no request context (a cron job reading its own pages), or null when it is not an OK HTML page.
 * @property {() => Promise<string[]>} stylesheets
 * @property {(page: Response) => Promise<Response>} earlyHints
 * @property {() => Promise<void>} routesReady
 * @property {(request: Request) => string | undefined} routeName
 */

/**
 * A site's own handlers beside the shared fetch: a queue consumer, or a scheduled of its own in place of `cron`.
 * @template E
 * @typedef {Pick<ExportedHandler<E, any>, "queue" | "scheduled" | "email">} SiteHandlers
 */

/** The security.txt path (RFC 9116 section 3). */
export const SECURITY_TXT_PATH = "/.well-known/security.txt";

/** Paths the gateway answers itself, which carry no React Router route in the log. */
const WORKER_PATHS = /^\/(api|health|mcp|media)(\/|$)/;

// The requests a machine file answered, logged under their own path (a site's splat route would name them "/*").
const answeredFiles = new WeakMap();

/**
 * @template E
 * @param {SiteOptions<E>} options
 * @returns {Site<E>}
 */
export function defineSite(options) {
  const requestHandler = createRequestHandler(options.serverBuild, options.mode);
  /** @type {((request: Request) => string | undefined) | undefined} */
  let nameRoute;
  let namerFailureLogged = false;
  /** @type {string[] | undefined} */
  let stylesheetHrefs;
  /** @type {string | undefined} */
  let hintHeader;

  const build = async () => options.serverBuild();
  const dev = options.mode === "development";

  /** @type {Site<E>} */
  const site = {
    options,
    async render(request, env, ctx, { nonce, set } = {}) {
      const context = new RouterContextProvider();
      // E is the site's own Env.
      context.set(cloudflareContext, { env: /** @type {Env} */ (env), ctx });
      context.set(cspNonceContext, nonce ?? null);
      options.context?.(context, env, ctx);
      set?.(context);
      const page = await timedRender((marks) => {
        context.set(serverTimingContext, marks);
        return requestHandler(request, context);
      });
      // A route that failed on D1 down (./log databaseDownStatus) answers 503 with Retry-After: a page, a .data
      // request and a resource route alike, since React Router gives a resource route's error no hook after it.
      // timedRender leaves the headers writable.
      const status = databaseDownStatus(request, page.status, page.headers);
      const answer =
        status === page.status ? page : new Response(page.body, { status, headers: page.headers });
      return dev && nonce ? withViteNonce(answer, nonce) : answer;
    },
    async renderHtml(request, env) {
      const ctx = /** @type {ExecutionContext} */ (
        /** @type {unknown} */ ({ waitUntil() {}, passThroughOnException() {}, props: {} })
      );
      const response = await site.render(request, env, ctx);
      const html = (response.headers.get("Content-Type") ?? "").includes("text/html");
      return response.ok && html ? response.text() : null;
    },
    async stylesheets() {
      stylesheetHrefs ??= pageStylesheets(await build(), options.stylesheetRoutes).map(
        (sheet) => sheet.href,
      );
      return stylesheetHrefs;
    },
    async earlyHints(page) {
      hintHeader ??= preloads([
        ...pageStylesheets(await build(), options.stylesheetRoutes),
        ...(options.preloads ?? []),
      ]).header;
      return withPreloadHeader(page, hintHeader);
    },
    async routesReady() {
      if (nameRoute) return;
      try {
        nameRoute = routeNamer((await build()).routes);
      } catch (error) {
        // This request's line goes unnamed; the next request tries again.
        if (!namerFailureLogged) {
          namerFailureLogged = true;
          logEvent("route_namer_failed", { error: errorMessage(error) }, { level: "warn" });
        }
      }
    },
    routeName(request) {
      const path = new URL(request.url).pathname;
      const own = answeredFiles.get(request) ?? gatewayRoute(path, options.routeName);
      if (own) return own;
      return WORKER_PATHS.test(path) ? undefined : nameRoute?.(request);
    },
  };
  return site;
}

/**
 * @param {string} path
 * @param {((path: string) => string | undefined) | undefined} extra
 */
function gatewayRoute(path, extra) {
  if (path === CSP_REPORT_PATH || path === SPECULATION_RULES_PATH || path === SECURITY_TXT_PATH)
    return path;
  if (path.startsWith("/preview/")) return "/preview/:token";
  if (path.startsWith("/api/carrel/")) return "/api/carrel/*";
  return extra?.(path);
}

/**
 * The cacheable entrypoint: `export class Renderer extends siteRenderer(WorkerEntrypoint, site) {}`.
 * @template {abstract new (...args: any[]) => object} T
 * @param {T} Base WorkerEntrypoint
 * @param {Site<any>} site
 * @returns {T & (abstract new (...args: any[]) => { fetch(request: Request): Promise<Response>, purgePages(why: string, tags?: string[]): Promise<boolean | null> })}
 */
export function siteRenderer(Base, site) {
  const { options } = site;
  // The mixin's body sees the base as the concrete entrypoint it is at run time (withPurgePages says why).
  const Purging =
    /** @type {new (...args: any[]) => { env: any, ctx: any, purgePages(why: string, tags?: string[]): Promise<boolean | null> }} */ (
      /** @type {unknown} */ (withPurgePages(Base, options.purgeKv ? { kv: options.purgeKv } : {}))
    );
  const tokenPath = tokenPattern(options.tokenRoutes);
  class Renderer extends Purging {
    /** @param {Request} request */
    fetch(request) {
      // Its own invocation, so its own Sentry client: a cached page's render error is reported from here.
      return withSentryRequest(request, this.env, this.ctx, { tokenPath }, async () => {
        const nonce = generateNonce();
        const shared = options.publicPages?.(new URL(request.url), this.env);
        const rendered = await site.render(request, this.env, this.ctx, { nonce });
        // A site whose routes name no Cache-Control of their own stores each 200 under the tags it names.
        if (shared && rendered.status === 200 && !rendered.headers.has("Cache-Control"))
          for (const [name, value] of Object.entries(publicPageHeaders(await shared)))
            rendered.headers.set(name, value);
        // A route that marks its answer shared but names no edge lifetime gets publicPageHeaders' day: with none, the
        // Workers cache reads `max-age=0` and keeps nothing a purge would ever need to reach.
        if (
          rendered.headers.get("Cache-Control") === SHARED_CACHE_CONTROL &&
          !rendered.headers.has(EDGE_CACHE_HEADER)
        )
          rendered.headers.set(EDGE_CACHE_HEADER, DEFAULT_EDGE_LIFETIME);
        const secured = await site.earlyHints(
          options.withSecurityHeaders(rendered, request, pageNonce(rendered, nonce), this.env),
        );
        return settleCacheHeaders(await stampValidator(secured), request, {
          publicCookies: options.publicCookies ?? [],
        });
      });
    }
  }
  return /** @type {any} */ (Renderer);
}

/** publicPageHeaders' edge lifetime: a day fresh, a week stale. */
const DEFAULT_EDGE_LIFETIME = publicPageHeaders()[EDGE_CACHE_HEADER];

/**
 * @param {Request} request
 * @param {readonly string[]} publicCookies
 * @returns {Record<string, string> | null} the public cookies' values, or null when any other cookie is present
 */
function publicCookieValues(request, publicCookies) {
  /** @type {Record<string, string>} */
  const values = {};
  for (const [name, value] of cookiePairs(request)) {
    if (!publicCookies.includes(name)) return null;
    values[name] = value;
  }
  return values;
}

/**
 * Under `vite dev` only: Vite's client injects each stylesheet as a <style> and takes its nonce from
 * `<meta property="csp-nonce">` (vite.dev/guide/features#content-security-policy-csp), so the page's policy lets it in.
 * @param {Response} page
 * @param {string} nonce
 */
function withViteNonce(page, nonce) {
  if (!page.headers.get("Content-Type")?.startsWith("text/html")) return page;
  return new HTMLRewriter()
    .on("head", {
      element: (head) =>
        void head.prepend(`<meta property="csp-nonce" nonce="${nonce}">`, { html: true }),
    })
    .transform(page);
}

/**
 * The nonce goes in the policy of a page only: a feed or a sitemap runs no script, and a stored one would hand every
 * reader the same value, which renewNonce leaves alone on anything but HTML.
 * @param {Response} response
 * @param {string} nonce
 */
function pageNonce(response, nonce) {
  return response.headers.get("Content-Type")?.startsWith("text/html") ? nonce : undefined;
}

/** @param {Response} page */
function withSpeculationRules(page) {
  if (!page.headers.get("Content-Type")?.startsWith("text/html")) return page;
  if (page.headers.get(SPECULATION_RULES_HEADER.name) === SPECULATION_RULES_HEADER.value)
    return page;
  // A stored or fetched response's headers can be immutable, so the header goes on a copy.
  const headers = new Headers(page.headers);
  headers.set(SPECULATION_RULES_HEADER.name, SPECULATION_RULES_HEADER.value);
  return new Response(page.body, { status: page.status, statusText: page.statusText, headers });
}

/**
 * A page or step answer drawn for one reader, never stored: a route's shared headers mean nothing here, and an answer
 * with no Cache-Control is said to be private rather than left to a heuristic (RFC 9111 4.2.2).
 * @param {Response} answer
 */
function forOneReader(answer) {
  const cacheControl = answer.headers.get("Cache-Control");
  return !cacheControl || cacheControl === SHARED_CACHE_CONTROL ? privateRender(answer) : answer;
}

/**
 * The Worker's default export: `{ fetch, scheduled }` and the site's own `handlers` (a `queue`, or a `scheduled` of its
 * own), all under Sentry (./sentry).
 * @template E
 * @template {SiteHandlers<E>} [H={}]
 * @param {Site<E>} site
 * @param {H} [handlers]
 * @returns {{ fetch: FetchHandler<E>, scheduled(controller: ScheduledController, env: E, ctx: ExecutionContext): Promise<void> } & H}
 */
export function siteWorker(site, handlers = /** @type {H} */ ({})) {
  const { options } = site;
  const secure = options.withSecurityHeaders;
  const exempt = options.crossSiteExempt ?? ["/api/auth/"];
  const purgeAfter = options.purgeAfter ?? ["/admin"];
  const publicCookies = options.publicCookies ?? [];
  const siteName = options.name;
  const tokenPath = tokenPattern(options.tokenRoutes);
  // A report's page and blocked addresses are cut to origin and path; a token route's token goes too.
  const logReport = (/** @type {Record<string, unknown>} */ line) =>
    console.log(JSON.stringify(scrubFields(line, { tokenPath })));

  /**
   * @param {Request} request
   * @param {E} env
   * @param {ExecutionContext & { exports?: any }} ctx
   */
  async function gateway(request, env, ctx) {
    const url = new URL(request.url);

    const canonical = options.canonical === false ? null : (options.canonical ?? {});
    const moved =
      canonical &&
      ((await canonical.before?.(request, env)) ??
        canonicalRedirect(
          request,
          canonical.keep?.(url)
            ? { ...canonical, except: [...(canonical.except ?? []), url.pathname] }
            : canonical,
        ));
    if (moved)
      return secure(
        moved,
        new Request(moved.headers.get("Location") ?? request.url),
        undefined,
        env,
      );

    if (maintenanceOn(/** @type {any} */ (env)) && url.pathname !== "/health")
      return secure(maintenanceResponse({ siteName }), request, undefined, env);

    if (url.pathname === SECURITY_TXT_PATH)
      return secure(securityTxtResponse({ origin: url.origin }), request, undefined, env);

    const file = await options.files?.(request, env);
    if (file) {
      answeredFiles.set(request, url.pathname);
      return secure(file, request, undefined, env);
    }

    if (url.pathname === SPECULATION_RULES_PATH)
      return secure(
        speculationRulesResponse({ exclude: options.speculationExclude ?? [] }, request),
        request,
        undefined,
        env,
      );

    if (url.pathname === CSP_REPORT_PATH) {
      const binding = /** @type {any} */ (env).CSP_REPORT_RATE_LIMIT;
      const allow = async (/** @type {Request} */ r) =>
        binding !== undefined && (await binding.limit({ key: clientIp(r) })).success;
      return secure(
        await receiveCspReport(request, { allow, log: logReport }),
        request,
        undefined,
        env,
      );
    }

    if (options.operator && url.pathname === "/api/operator") {
      const e = /** @type {any} */ (env);
      return secure(
        await operatorResponse(request, {
          token: e.OPERATOR_TOKEN,
          limiter: e.RATE_LIMITER,
          tools: options.operator(env, ctx),
        }),
        request,
        undefined,
        env,
      );
    }

    if (!exempt.some((prefix) => url.pathname.startsWith(prefix))) {
      const refused = refuseCrossSite(request);
      if (refused) return secure(refused, request, undefined, env);
    }

    /** @type {GatewayKit} */
    const kit = {
      url,
      render: (r, extra) => site.render(r, env, ctx, extra),
      stylesheets: () => site.stylesheets(),
      purgeAfterWrite: (r, response, why) => purgeAfterWrite(r, response, ctx, why),
      secure: (response, r = request, nonce) => secure(response, r, nonce, env),
    };
    for (const step of options.steps ?? []) {
      const answer = await step(request, env, ctx, kit);
      if (answer) return forOneReader(secure(answer, request, undefined, env));
    }

    const cookies = publicCookieValues(request, publicCookies);
    if (
      !isWrite(request) &&
      cookies &&
      url.pathname !== "/health" &&
      (options.cacheable?.(request, url, env) ?? true)
    ) {
      const stored = await ctx.exports.Renderer.fetch(forRenderer(request), {
        cf: { cacheKey: cacheKey(url, { dimensions: { host: url.host, ...cookies } }) },
      });
      const reader = forReader(renewNonce(stored), request, { publicCookies });
      if (reader.status !== 304) return reader;
      const headers = new Headers(reader.headers);
      headers.delete("Content-Security-Policy");
      headers.delete("Content-Security-Policy-Report-Only");
      return new Response(null, { status: 304, headers });
    }

    const nonce = generateNonce();
    const response = await site.render(request, env, ctx, { nonce });
    if (isWrite(request) && purgeAfter.some((prefix) => url.pathname.startsWith(prefix)))
      purgeAfterWrite(request, response, ctx, `${request.method} ${url.pathname}`);
    return forOneReader(
      await site.earlyHints(secure(response, request, pageNonce(response, nonce), env)),
    );
  }

  /**
   * @param {Request} request
   * @param {E} env
   * @param {ExecutionContext} ctx
   */
  async function guarded(request, env, ctx) {
    const path = new URL(request.url).pathname;
    let response;
    try {
      response = await gateway(request, env, ctx);
    } catch (error) {
      logEvent(
        "gateway_error",
        { path, error: errorMessage(error) },
        { level: "error", tokenPath },
      );
      return secure(
        textResponse("Something went wrong on our side. Please try again.", 500),
        request,
        undefined,
        env,
      );
    }
    if (response.status === 404 && options.onNotFound)
      response = await options.onNotFound(response, request, env);
    if (!path.startsWith("/api/") && !path.startsWith("/preview/")) {
      const db = options.notFoundDb?.(env) ?? /** @type {any} */ (env).DB;
      if (db) countNotFound(db, request, response, ctx);
    }
    return compressUntransformed(withSpeculationRules(response), request);
  }

  /**
   * @param {Request} request
   * @param {E} env
   * @param {ExecutionContext} ctx
   */
  const idled = (request, env, ctx) => {
    /** @type {() => Promise<Response>} */
    let handle = () => guarded(request, env, ctx);
    // Innermost first, so the list's first entry wraps the rest, as SiteOptions.adminIdle says.
    for (const idle of [...(options.adminIdle ?? [])].reverse()) {
      const inner = handle;
      handle = () =>
        withAdminIdle(request, inner, {
          prefixes: idle.prefixes,
          cookieName: idle.cookieName,
          secret: idle.secret(env),
        });
    }
    return handle();
  };

  const wrapped = options.wrap ? options.wrap(idled) : idled;

  const fetch = withRequestLog(
    async (
      /** @type {Request} */ request,
      /** @type {E} */ env,
      /** @type {ExecutionContext} */ ctx,
    ) => {
      // After the answer, which a render has already loaded the build for: two imports of it at once on an isolate's
      // first request is what vitest's module mocker answers with the unmocked module, so a site's tests drew the stub.
      const response = await wrapped(request, env, ctx);
      await site.routesReady();
      return response;
    },
    {
      sha: (env) => options.sha?.(env) ?? deployedSha(env),
      tokenPath,
      route: (request) => site.routeName(request),
    },
  );

  return withSiteSentry(
    {
      fetch,
      /**
       * @param {ScheduledController} controller
       * @param {E} env
       * @param {ExecutionContext} ctx
       */
      async scheduled(controller, env, ctx) {
        const lists = await options.cron?.(env, new Date(controller.scheduledTime), ctx);
        const jobs = lists?.[controller.cron];
        if (!jobs) {
          logEvent("cron_unknown", { cron: controller.cron }, { level: "warn" });
          return;
        }
        await runJobs(/** @type {any} */ (env).DB, jobs);
      },
      ...handlers,
    },
    { tokenPath },
  );
}
