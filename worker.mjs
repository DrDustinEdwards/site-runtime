/**
 * The one Worker every React Router site runs: the gateway, the Renderer the Workers cache stores pages from, the
 * request log around them and the cron handler. A site names what is its own (its steps, header set, preloads).
 *
 * The gateway's steps, in order:
 * 1. Canonical address (./url canonicalRedirect), first, so an http request never gets a policy whose report endpoint is
 *    http. `canonical.before` is a site's own earlier move; `canonical.keep(url)` keeps an address's trailing slash.
 * 2. Maintenance (./maintenance): every path but /health answers 503 while MAINTENANCE is on.
 * 3. /.well-known/security.txt (./security-txt, RFC 9116).
 * 4. The standard files (Prelum's standardFiles), when the site passes `files`.
 * 5. The speculation rules file (./prefetch), with the site's exclude list.
 * 6. CSP reports (./csp-report), limited per caller address by CSP_REPORT_RATE_LIMIT; with none, or over it, dropped (204).
 * 7. The operator API (./operator) at /api/operator, when the site passes `operator`.
 * 8. A cross-site write is refused (./origin refuseCrossSite) on every path but `crossSiteExempt` (default
 *    /api/auth/), before the steps, so an app's own cookie-authenticated API gets the check too.
 * 9. The site's own `steps`, in order; the first answer wins and gets the security set (a policy it carries is kept).
 *    A write a step accepts purges the stored pages when the step says so (`kit.purgeAfterWrite`).
 * 10. The page. A read with no cookie but `publicCookies`, not refused by `cacheable`, goes to the Renderer through the
 *     Workers cache, keyed on the path, the query without tracking parameters, the host and each public cookie's value
 *     (a file path too: anything not shared leaves with an edge no-store). Everything else is rendered live with its
 *     own nonce and leaves private, no-store unless the route said otherwise. A live write on a `purgeAfter` path
 *     (default /admin) purges the stored pages.
 *
 * Every render gets a nonce (./react-entry), renewed per reader (./csp renewNonce). A 304 from the cache leaves out the
 * policy: RFC 9111 4.3.4 has the browser update its stored headers from a 304, and a new nonce would not match.
 *
 * On the way out every HTML answer carries the Speculation-Rules header, a private page is compressed by the Worker
 * (./edge-cache PRIVATE_PAGE_HEADERS), a 404 is counted (./not-found) unless under /api/ or /preview/ and goes through
 * `onNotFound`. A gateway that throws answers a plain 500 and logs `gateway_error`. A render whose route failed because
 * D1 was down answers 503 with Retry-After and no-store (./log databaseDownStatus).
 *
 * Around the gateway, outermost first: the request log (./log; the route named from the React Router build, loaded and
 * awaited inside the request, since a promise left from a finished request can stay unsettled in workerd), the site's
 * `wrap`, then the admin idle sign-out (./access) for each of `adminIdle`. Under `vite dev` a page also carries
 * `<meta property="csp-nonce">` for Vite's styles. A page a route marks shared (`public, max-age=0`) with no edge
 * lifetime is stored for publicPageHeaders' day, so a purge has something to reach; no site hook rewrites an answer's
 * Cache-Control.
 *
 * Cron: `cron(env, date, ctx)[controller.cron]` runs through ./cron runJobs; a trigger with no list warns `cron_unknown`.
 *
 * In workers/app.ts:
 *   const site = defineSite({ ... });
 *   export class Renderer extends siteRenderer(WorkerEntrypoint, site) {}
 *   export default siteWorker(site);
 *
 * Needs `react-router` (not declared, as for ./context).
 */
import { withAdminIdle } from "./access.mjs";
import { CSP_REPORT_PATH, generateNonce, renewNonce } from "./csp.mjs";
import { receiveCspReport } from "./csp-report.mjs";
import { runJobs } from "./cron.mjs";
import {
  cacheKey,
  compressUntransformed,
  forReader,
  forRenderer,
  purgeAfterWrite,
} from "./edge-cache.mjs";
import { clientIp, isWrite, textResponse } from "./http.mjs";
import { errorMessage, logEvent, scrubFields, tokenPattern, withRequestLog } from "./log.mjs";
import { maintenanceOn, maintenanceResponse } from "./maintenance.mjs";
import { countNotFound } from "./not-found.mjs";
import { operatorResponse } from "./operator.mjs";
import { refuseCrossSite } from "./origin.mjs";
import { SPECULATION_RULES_PATH, speculationRulesResponse } from "./prefetch.mjs";
import { securityTxtResponse } from "./security-txt.mjs";
import { canonicalRedirect } from "./url.mjs";
import { deployedSha } from "./deploy.mjs";
import { withSiteSentry } from "./sentry.mjs";
import { SECURITY_TXT_PATH, answeredFiles } from "./worker-site.mjs";
import {
  forOneReader,
  pageNonce,
  publicCookieValues,
  withSpeculationRules,
} from "./worker-response.mjs";

export { defineSite, siteRenderer } from "./worker-site.mjs";
export { SECURITY_TXT_PATH };

/** @import { RouterContextProvider, ServerBuild } from "react-router" */
/** @import { CronJob } from "./cron.mjs" */
/** @import { OperatorTool } from "./operator.mjs" */
/** @import { Preconnect, Preload } from "./preload.mjs" */
/** @import { AccessSecrets, AdminSettings } from "./access.mjs" */

/**
 * The secrets and dashboard vars every site's Worker reads through site-runtime, which `wrangler types` cannot see. A
 * site's env.d.ts extends it (`interface Env extends SiteSecrets {}`). Each is optional where the code that reads it
 * fails closed when unset.
 *
 * - `MAINTENANCE`: "1" or "true" puts the site in maintenance (./maintenance).
 * - `ADMIN_IDLE_SECRET`: Keys the admin idle cookie (withAdminIdle `secret`), minted by the deploy.
 * - `OPERATOR_TOKEN`: The bearer for /api/operator (./operator), 32 characters or more; unset or short: 503.
 * - `CARREL_SITE_KEY`: Carrel's key for site-api's /api/carrel/v1, 32 characters or more; unset or short: refused.
 * - `ANTHROPIC_API_KEY`: The Anthropic key for the site's AI features.
 * - `TURNSTILE_SITE_KEY`: Turnstile on the sign-in email link (./sign-in); on only when both keys are set.
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

/** @typedef {{ nonce?: string; set?: (context: RouterContextProvider) => void }} RenderExtra `set` sets the site's own context keys for one render (a preview's page). */

/**
 * A site step: answers the request, or undefined to pass it on.
 * @template E
 * @typedef {(
 * request: Request,
 * env: E,
 * ctx: ExecutionContext,
 * kit: GatewayKit,
 * ) => Response | undefined | null | Promise<Response | undefined | null>} GatewayStep
 */

/** @template E @typedef {(request: Request, env: E, ctx: ExecutionContext) => Promise<Response>} FetchHandler */

/**
 * @template E
 * @typedef {object} SiteOptions
 * @property {string} name The site's name on the maintenance page.
 * @property {() => Promise<ServerBuild>} serverBuild `() => import("virtual:react-router/server-build")`.
 * @property {string} [mode] `import.meta.env.MODE`.
 * @property {(response: Response, request: Request, nonce?: string, env?: E) => Response} withSecurityHeaders The site's security set: pageSecurity's withSecurityHeaders.
 * @property {| false | { host?: string; except?: string[]; before?: ( request: Request, env: E, ) => Response | null | undefined | Promise<Response | null | undefined>; keep?: (url: URL) => boolean; }} [canonical] canonicalRedirect's options (`host`, `except`), plus `before`, a site's own earlier move, and `keep`, a test for an address whose slash stays; false for none.
 * @property {(request: Request, env: E) => Promise<Response | null> | Response | null} [files] Prelum's standardFiles handler (robots.txt, ai.txt, site.webmanifest, IndexNow key, ownership files).
 * @property {string} [securityContact] The Contact in /.well-known/security.txt: an address or a URL; default the network's (SECURITY_CONTACT). A site that is not part of the network names its own.
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
 * @property {() => Promise<string[]>} stylesheets
 * @property {(page: Response) => Promise<Response>} earlyHints
 * @property {() => Promise<void>} routesReady
 * @property {(request: Request) => string | undefined} routeName
 */

/** @template E @typedef {Pick<ExportedHandler<E, any>, "queue" | "scheduled" | "email">} SiteHandlers A queue consumer, or a scheduled of its own in place of `cron`. */

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
      return secure(
        securityTxtResponse({ origin: url.origin, contact: options.securityContact }),
        request,
        undefined,
        env,
      );

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
    // Innermost first, so the list's first entry wraps the rest.
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
      // After the answer: two imports of the build at once on an isolate's first request make vitest's mocker answer
      // with the unmocked module.
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
