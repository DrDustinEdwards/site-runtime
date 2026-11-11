import type { RouterContextProvider, ServerBuild } from "react-router";
import type { CronJob } from "./cron.mjs";
import type { OperatorTool } from "./operator.mjs";
import type { Preconnect, Preload } from "./preload.mjs";

/** A preview link's token (Carrel's /preview/<token>), cut from a logged path. */
export const PREVIEW_TOKEN: RegExp;
/** PREVIEW_TOKEN with the site's token routes ("u", "e/c"): each match is logged as `/<route>/[token]`. */
export function tokenPattern(routes?: readonly string[]): RegExp;
/** "/.well-known/security.txt", answered by every site's gateway. */
export const SECURITY_TXT_PATH: "/.well-known/security.txt";

/** What a site step gets beside the request. */
export interface GatewayKit {
  url: URL;
  /** The page's route rendered in-process (a Carrel preview), with `nonce` and any extra context `set`. */
  render(request: Request, extra?: RenderExtra): Promise<Response>;
  /** The root route's stylesheet hrefs, for a preview drawn outside React Router. */
  stylesheets(): Promise<string[]>;
  /** Purges the stored pages once a write it accepted has answered 2xx. */
  purgeAfterWrite(request: Request, response: Response, why: string): void;
  /** The site's security set on `response`. */
  secure(response: Response, request?: Request, nonce?: string): Response;
}

export interface RenderExtra {
  nonce?: string;
  /** Sets the site's own context keys for this one render (a preview's page). */
  set?: (context: RouterContextProvider) => void;
}

/**
 * A site step: answers the request, or undefined to pass it on. The answer gets the security set (a policy it carries
 * itself is kept).
 */
export type GatewayStep<E> = (
  request: Request,
  env: E,
  ctx: ExecutionContext,
  kit: GatewayKit,
) => Response | undefined | null | Promise<Response | undefined | null>;

export type FetchHandler<E> = (
  request: Request,
  env: E,
  ctx: ExecutionContext,
) => Promise<Response>;

export interface SiteOptions<E> {
  /** The site's name on the maintenance page. */
  name: string;
  /** `() => import("virtual:react-router/server-build")`. */
  serverBuild: () => Promise<ServerBuild>;
  /** `import.meta.env.MODE`. */
  mode?: string;
  /** The site's security set: pageSecurity's withSecurityHeaders. */
  withSecurityHeaders: (response: Response, request: Request, nonce?: string, env?: E) => Response;
  /**
   * canonicalRedirect's options (`host`, `except`), plus `before`, a site's own earlier move, and `keep`, a test for an
   * address whose slash stays; false for none.
   */
  canonical?:
    | false
    | {
        host?: string;
        except?: string[];
        before?: (
          request: Request,
          env: E,
        ) => Response | null | undefined | Promise<Response | null | undefined>;
        /** True keeps this address's trailing slash, as `except` does for a fixed path; https still applies. */
        keep?: (url: URL) => boolean;
      };
  /** Prelum's standardFiles handler (robots.txt, ai.txt, site.webmanifest, IndexNow key, ownership files). */
  files?: (request: Request, env: E) => Promise<Response | null> | Response | null;
  /** Paths the hover prefetch never fetches, beyond NEVER_PREFETCH. */
  speculationExclude?: string[];
  /** The operator API's tools, served at /api/operator behind OPERATOR_TOKEN and RATE_LIMITER. */
  operator?: (env: E, ctx: ExecutionContext) => Record<string, OperatorTool>;
  /** The site's own steps, in order, before the cross-site check and the page. */
  steps?: GatewayStep<E>[];
  /** Path prefixes a cross-site write may reach (default ["/api/auth/"]). */
  crossSiteExempt?: string[];
  /** Path prefixes whose accepted live writes purge the stored pages (default ["/admin"]). */
  purgeAfter?: string[];
  /** Cookies that change nothing private; their values join the cache key (a theme). */
  publicCookies?: string[];
  /** False keeps a read from the Renderer (a private path, a signed-in-only area); the standard rule applies first. */
  cacheable?: (request: Request, url: URL, env: E) => boolean;
  /**
   * For a site whose routes name no Cache-Control: a 200 the Renderer draws without one is stored, under these tags
   * (publicPageHeaders' options: `tags`, `until`). A route's own Cache-Control is left alone.
   */
  publicPages?: (
    url: URL,
    env: E,
  ) => Promise<Parameters<typeof import("./edge-cache.mjs").publicPageHeaders>[0]>;
  /** Preloads beyond the root stylesheets, for the Early Hints header (fonts). */
  preloads?: (Preload | Preconnect)[];
  /**
   * The last word on a page or a step's answer, after the security set: a site's own cache rule (Foxhound's route
   * classes, Vary: Cookie). `stored` is true in the Renderer, whose answer the Workers cache keeps (settleCacheHeaders
   * still runs after it); false for a step's answer or a page rendered for one reader (privateRender still runs after).
   */
  respond?: (
    response: Response,
    request: Request,
    env: E,
    where: { stored: boolean },
  ) => Response | Promise<Response>;
  /** Sets the site's own context keys on every render. cloudflareContext and cspNonceContext are set already. */
  context?: (context: RouterContextProvider, env: E, ctx: ExecutionContext) => void;
  /** The KV that keeps the last failed purge, for purgeCheck. */
  purgeKv?: (env: E) => Parameters<typeof import("./edge-cache.mjs").recordPurge>[0];
  /** A 404's last word: site-api's tombstoned, a 410 for a path Carrel removed. */
  onNotFound?: (response: Response, request: Request, env: E) => Response | Promise<Response>;
  /** Where 404s are counted; default env.DB. */
  notFoundDb?: (
    env: E,
  ) => Parameters<typeof import("./not-found.mjs").countNotFound>[0] | undefined;
  /** Wraps the gateway inside the request log: Prelum's markdownCopies. */
  wrap?: (handler: FetchHandler<E>) => FetchHandler<E>;
  /** Admin idle sign-outs (./access withAdminIdle), outermost first. */
  adminIdle?: { prefixes?: string[]; cookieName?: string; secret: (env: E) => string }[];
  /** The job lists by cron expression, for the firing at `scheduledTime`. */
  cron?: (
    env: E,
    scheduledTime: Date,
    ctx: ExecutionContext,
  ) => Record<string, CronJob[] | undefined> | Promise<Record<string, CronJob[] | undefined>>;
  /** The deployed commit; default env.DEPLOY_SHA. */
  sha?: (env: E) => string | undefined;
  /**
   * The site's token routes beside /preview/, as path prefixes without slashes ("u", "e/c"): the token after one is cut
   * from the request log and from CSP reports (a report names the page it came from).
   */
  tokenRoutes?: readonly string[];
  /** Log route names for paths a site step answers. */
  routeName?: (path: string) => string | undefined;
}

export interface Site<E> {
  options: SiteOptions<E>;
  render(request: Request, env: E, ctx: ExecutionContext, extra?: RenderExtra): Promise<Response>;
  stylesheets(): Promise<string[]>;
  earlyHints(page: Response): Promise<Response>;
  routesReady(): Promise<void>;
  routeName(request: Request): string | undefined;
}

/** The site's configuration, built once at module scope. */
export function defineSite<E>(options: SiteOptions<E>): Site<E>;

/** The Renderer entrypoint's base: `export class Renderer extends siteRenderer(WorkerEntrypoint, site) {}`. */
// oxlint-disable-next-line typescript/no-explicit-any -- a mixin's constructor must take (...args: any[])
export function siteRenderer<T extends abstract new (...args: any[]) => object>(
  Base: T,
  // oxlint-disable-next-line typescript/no-explicit-any -- the site's own Env
  site: Site<any>,
): T &
  // oxlint-disable-next-line typescript/no-explicit-any -- the same mixin constructor, as TypeScript requires it
  (abstract new (...args: any[]) => {
    fetch(request: Request): Promise<Response>;
    purgePages(why: string, tags?: string[]): Promise<boolean | null>;
  });

/** The Worker's default export. */
export function siteWorker<E>(site: Site<E>): {
  fetch: FetchHandler<E>;
  scheduled(controller: ScheduledController, env: E, ctx: ExecutionContext): Promise<void>;
};
