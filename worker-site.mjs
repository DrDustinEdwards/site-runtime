/** The Worker's site definition and cacheable Renderer entrypoint (see worker.mjs). */

import { createRequestHandler, RouterContextProvider } from "react-router";
import { cloudflareContext, cspNonceContext, serverTimingContext } from "./context.mjs";
import { CSP_REPORT_PATH, generateNonce } from "./csp.mjs";
import {
  EDGE_CACHE_HEADER,
  SHARED_CACHE_CONTROL,
  publicPageHeaders,
  settleCacheHeaders,
  stampValidator,
  withPurgePages,
} from "./edge-cache.mjs";
import { databaseDownStatus, errorMessage, logEvent, routeNamer, tokenPattern } from "./log.mjs";
import { SPECULATION_RULES_PATH } from "./prefetch.mjs";
import { pageStylesheets, preloads, withPreloadHeader } from "./preload.mjs";
import { withSentryRequest } from "./sentry.mjs";
import { timedRender } from "./server-timing.mjs";
import { pageNonce, withViteNonce } from "./worker-response.mjs";

/** @import { Site, SiteOptions } from "./worker.mjs" */
/** @import { RenderExtra } from "./worker.mjs" */

export const SECURITY_TXT_PATH = "/.well-known/security.txt";

const WORKER_PATHS = /^\/(api|health|mcp|media)(\/|$)/;

// Requests a machine file answered, logged under their own path (a splat route would name them "/*").
export const answeredFiles = new WeakMap();

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
      context.set(cloudflareContext, { env: /** @type {Env} */ (env), ctx });
      context.set(cspNonceContext, nonce ?? null);
      options.context?.(context, env, ctx);
      set?.(context);
      const page = await timedRender((marks) => {
        context.set(serverTimingContext, marks);
        return requestHandler(request, context);
      });
      // A route that failed on D1 down answers 503 with Retry-After, a resource route's too (React Router gives its
      // error no hook after it).
      const status = databaseDownStatus(request, page.status, page.headers);
      const answer =
        status === page.status ? page : new Response(page.body, { status, headers: page.headers });
      return dev && nonce ? withViteNonce(answer, nonce) : answer;
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

/** @param {string} path @param {((path: string) => string | undefined) | undefined} extra */
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
  const Purging =
    /** @type {new (...args: any[]) => { env: any, ctx: any, purgePages(why: string, tags?: string[]): Promise<boolean | null> }} */ (
      /** @type {unknown} */ (withPurgePages(Base, options.purgeKv ? { kv: options.purgeKv } : {}))
    );
  const tokenPath = tokenPattern(options.tokenRoutes);
  class Renderer extends Purging {
    /** @param {Request} request */
    fetch(request) {
      return withSentryRequest(request, this.env, this.ctx, { tokenPath }, async () => {
        const nonce = generateNonce();
        const shared = options.publicPages?.(new URL(request.url), this.env);
        shared?.catch(() => {}); // awaited only for a cacheable 200: a failing lookup must not go unhandled
        const rendered = await site.render(request, this.env, this.ctx, { nonce });
        if (shared && rendered.status === 200 && !rendered.headers.has("Cache-Control"))
          for (const [name, value] of Object.entries(publicPageHeaders(await shared)))
            rendered.headers.set(name, value);
        // With no edge lifetime the Workers cache reads `max-age=0` and keeps nothing a purge could reach.
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

const DEFAULT_EDGE_LIFETIME = publicPageHeaders()[EDGE_CACHE_HEADER];
