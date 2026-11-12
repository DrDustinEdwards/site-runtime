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
 * 8. The site's own steps (`steps`: its media files, Carrel's site API, an app's API), in order; the first answer wins.
 *    A step's answer gets the security set (a policy the answer carries itself is kept). A write a step accepts purges
 *    the stored pages when the step says so (`kit.purgeAfterWrite`).
 * 9. A cross-site write is refused (./origin refuseCrossSite) on every path but `crossSiteExempt` (default /api/auth/,
 *    where Better Auth checks its own origins and Apple's form_post arrives cross-site).
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
 * On the way out, every HTML answer carries the Speculation-Rules header, a 404 is counted (./not-found) unless it is
 * under /api/ or /preview/, and a 404 goes through the site's `onNotFound` (site-api's tombstones, a 410). A gateway
 * that throws answers a plain 500 with the security set and logs `gateway_error`, never the runtime's 1101 page.
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
  forReader,
  forRenderer,
  privateRender,
  publicPageHeaders,
  purgeAfterWrite,
  settleCacheHeaders,
  withPurgePages,
} from "./edge-cache.mjs";
import { clientIp, isWrite, textResponse } from "./http.mjs";
import {
  PREVIEW_TOKEN,
  errorMessage,
  logEvent,
  routeNamer,
  scrubFields,
  tokenPattern,
  withRequestLog,
} from "./log.mjs";

export { PREVIEW_TOKEN, tokenPattern };
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

/** The security.txt path (RFC 9116 section 3). */
export const SECURITY_TXT_PATH = "/.well-known/security.txt";

/** Paths the gateway answers itself, which carry no React Router route in the log. */
const WORKER_PATHS = /^\/(api|health|mcp|media)(\/|$)/;

// The requests a machine file answered, logged under their own path (a site's splat route would name them "/*").
const answeredFiles = new WeakMap();

/**
 * @template E
 * @param {import("./worker.d.mts").SiteOptions<E>} options
 * @returns {import("./worker.d.mts").Site<E>}
 */
export function defineSite(options) {
  const requestHandler = createRequestHandler(options.serverBuild, options.mode);
  /** @type {((request: Request) => string | undefined) | undefined} */
  let nameRoute;
  /** @type {string[] | undefined} */
  let stylesheetHrefs;
  /** @type {string | undefined} */
  let hintHeader;

  const build = async () => options.serverBuild();
  const dev = options.mode === "development";

  /** @type {import("./worker.d.mts").Site<E>} */
  const site = {
    options,
    async render(request, env, ctx, { nonce, set } = {}) {
      const context = new RouterContextProvider();
      context.set(cloudflareContext, { env, ctx });
      context.set(cspNonceContext, nonce ?? null);
      options.context?.(context, env, ctx);
      set?.(context);
      const page = await timedRender((marks) => {
        context.set(serverTimingContext, marks);
        return requestHandler(request, context);
      });
      return dev && nonce ? withViteNonce(page, nonce) : page;
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
      } catch {
        // This request's line goes unnamed; the next request tries again.
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
 * @param {abstract new (...args: any[]) => { env: any, ctx: any }} Base
 * @param {import("./worker.d.mts").Site<any>} site
 */
export function siteRenderer(Base, site) {
  const { options } = site;
  const Purging = withPurgePages(Base, options.purgeKv ? { kv: options.purgeKv } : {});
  return class Renderer extends Purging {
    /** @param {Request} request */
    async fetch(request) {
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
      return settleCacheHeaders(secured, request, { publicCookies: options.publicCookies ?? [] });
    }
  };
}

/** publicPageHeaders' edge lifetime: a day fresh, a week stale. */
const DEFAULT_EDGE_LIFETIME = publicPageHeaders()[EDGE_CACHE_HEADER];

/**
 * @param {Request} request
 * @param {readonly string[]} publicCookies
 * @returns {Record<string, string> | null} the public cookies' values, or null when any other cookie is present
 */
function publicCookieValues(request, publicCookies) {
  const header = request.headers.get("Cookie");
  /** @type {Record<string, string>} */
  const values = {};
  if (!header) return values;
  for (const part of header.split(";")) {
    const pair = part.trim();
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const name = eq < 0 ? pair : pair.slice(0, eq);
    if (!publicCookies.includes(name)) return null;
    values[name] = eq < 0 ? "" : pair.slice(eq + 1);
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
 * The Worker's default export: `{ fetch, scheduled }`.
 * @template E
 * @param {import("./worker.d.mts").Site<E>} site
 */
export function siteWorker(site) {
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

    /** @type {import("./worker.d.mts").GatewayKit} */
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

    if (!exempt.some((prefix) => url.pathname.startsWith(prefix))) {
      const refused = refuseCrossSite(request);
      if (refused) return secure(refused, request, undefined, env);
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
    return withSpeculationRules(response);
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

  return {
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
  };
}
