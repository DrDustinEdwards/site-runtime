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
export function siteWorker<E, H extends SiteHandlers<E> = {}>(site: Site<E>, handlers?: H): {
    fetch: FetchHandler<E>;
    scheduled(controller: ScheduledController, env: E, ctx: ExecutionContext): Promise<void>;
} & H;
export { SECURITY_TXT_PATH };
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
 */
export type SiteSecrets = AdminSettings & Partial<AccessSecrets> & {
    MAINTENANCE?: string;
    ADMIN_IDLE_SECRET: string;
    OPERATOR_TOKEN?: string;
    CARREL_SITE_KEY?: string;
    ANTHROPIC_API_KEY?: string;
    TURNSTILE_SITE_KEY?: string;
    TURNSTILE_SECRET_KEY?: string;
};
/**
 * What a site step gets beside the request.
 *
 * - `render`: The page's route rendered in-process (a Carrel preview), with `nonce` and any extra context `set`.
 * - `stylesheets`: The page stylesheet hrefs (the root's and `stylesheetRoutes`'), for a preview drawn outside React Router.
 * - `purgeAfterWrite`: Purges the stored pages once a write it accepted has answered 2xx.
 * - `secure`: The site's security set on `response`.
 */
export type GatewayKit = {
    url: URL;
    render(request: Request, extra?: RenderExtra): Promise<Response>;
    stylesheets(): Promise<string[]>;
    purgeAfterWrite(request: Request, response: Response, why: string): void;
    secure(response: Response, request?: Request, nonce?: string): Response;
};
/**
 * `set` sets the site's own context keys for one render (a preview's page).
 */
export type RenderExtra = {
    nonce?: string;
    set?: (context: RouterContextProvider) => void;
};
/**
 * A site step: answers the request, or undefined to pass it on.
 */
export type GatewayStep<E> = (request: Request, env: E, ctx: ExecutionContext, kit: GatewayKit) => Response | undefined | null | Promise<Response | undefined | null>;
export type FetchHandler<E> = (request: Request, env: E, ctx: ExecutionContext) => Promise<Response>;
export type SiteOptions<E> = {
    /**
     * The site's name on the maintenance page.
     */
    name: string;
    /**
     * `() => import("virtual:react-router/server-build")`.
     */
    serverBuild: () => Promise<ServerBuild>;
    /**
     * `import.meta.env.MODE`.
     */
    mode?: string | undefined;
    /**
     * The site's security set: pageSecurity's withSecurityHeaders.
     */
    withSecurityHeaders: (response: Response, request: Request, nonce?: string, env?: E) => Response;
    /**
     * canonicalRedirect's options (`host`, `except`), plus `before`, a site's own earlier move, and `keep`, a test for an address whose slash stays; false for none.
     */
    canonical?: false | {
        host?: string;
        except?: string[];
        before?: (request: Request, env: E) => Response | null | undefined | Promise<Response | null | undefined>;
        keep?: (url: URL) => boolean;
    } | undefined;
    /**
     * Prelum's standardFiles handler (robots.txt, ai.txt, site.webmanifest, IndexNow key, ownership files).
     */
    files?: ((request: Request, env: E) => Promise<Response | null> | Response | null) | undefined;
    /**
     * Paths the hover prefetch never fetches, beyond NEVER_PREFETCH.
     */
    speculationExclude?: string[] | undefined;
    /**
     * The operator API's tools, served at /api/operator behind OPERATOR_TOKEN and RATE_LIMITER.
     */
    operator?: ((env: E, ctx: ExecutionContext) => Record<string, OperatorTool>) | undefined;
    /**
     * The site's own steps, in order, after the cross-site check and before the page.
     */
    steps?: GatewayStep<E>[] | undefined;
    /**
     * Path prefixes a cross-site write may reach (default ["/api/auth/"]).
     */
    crossSiteExempt?: string[] | undefined;
    /**
     * Path prefixes whose accepted live writes purge the stored pages (default ["/admin"]).
     */
    purgeAfter?: string[] | undefined;
    /**
     * Cookies that change nothing private; their values join the cache key (a theme).
     */
    publicCookies?: string[] | undefined;
    /**
     * False keeps a read from the Renderer (a private path, a signed-in-only area); the standard rule applies first.
     */
    cacheable?: ((request: Request, url: URL, env: E) => boolean) | undefined;
    /**
     * For a site whose routes name no Cache-Control: a 200 the Renderer draws without one is stored, under these tags (publicPageHeaders' options: `tags`, `until`). A route's own Cache-Control is left alone.
     */
    publicPages?: ((url: URL, env: E) => Promise<Parameters<typeof import("./edge-cache.mjs").publicPageHeaders>[0]>) | undefined;
    /**
     * Preloads beyond the page stylesheets, for the Early Hints header (fonts).
     */
    preloads?: (Preload | Preconnect)[] | undefined;
    /**
     * Route ids beyond the root whose stylesheets every page loads, such as a layout's ("routes/_site"): they join the root's in the Early Hints header and in `stylesheets()`, which a preview drawn outside React Router reads.
     */
    stylesheetRoutes?: readonly string[] | undefined;
    /**
     * Sets the site's own context keys on every render. cloudflareContext and cspNonceContext are set already.
     */
    context?: ((context: RouterContextProvider, env: E, ctx: ExecutionContext) => void) | undefined;
    /**
     * The KV that keeps the last failed purge, for purgeCheck.
     */
    purgeKv?: ((env: E) => Parameters<typeof import("./edge-cache.mjs").recordPurge>[0]) | undefined;
    /**
     * A 404's last word: site-api's tombstoned, a 410 for a path Carrel removed.
     */
    onNotFound?: ((response: Response, request: Request, env: E) => Response | Promise<Response>) | undefined;
    /**
     * Where 404s are counted; default env.DB.
     */
    notFoundDb?: ((env: E) => Parameters<typeof import("./not-found.mjs").countNotFound>[0] | undefined) | undefined;
    /**
     * Wraps the gateway inside the request log: Prelum's markdownCopies.
     */
    wrap?: ((handler: FetchHandler<E>) => FetchHandler<E>) | undefined;
    /**
     * Admin idle sign-outs (./access withAdminIdle), outermost first.
     */
    adminIdle?: {
        prefixes?: string[];
        cookieName?: string;
        secret: (env: E) => string;
    }[] | undefined;
    /**
     * The job lists by cron expression, for the firing at `scheduledTime`.
     */
    cron?: ((env: E, scheduledTime: Date, ctx: ExecutionContext) => Record<string, CronJob[] | undefined> | Promise<Record<string, CronJob[] | undefined>>) | undefined;
    /**
     * The deployed commit; default env.DEPLOY_SHA.
     */
    sha?: ((env: E) => string | undefined) | undefined;
    /**
     * The site's token routes beside /preview/, as path prefixes without slashes ("u", "e/c"): the token after one is cut from the request log and from CSP reports (a report names the page it came from).
     */
    tokenRoutes?: readonly string[] | undefined;
    /**
     * Log route names for paths a site step answers.
     */
    routeName?: ((path: string) => string | undefined) | undefined;
};
export type Site<E> = {
    options: SiteOptions<E>;
    render: (request: Request, env: E, ctx: ExecutionContext, extra?: RenderExtra) => Promise<Response>;
    stylesheets: () => Promise<string[]>;
    earlyHints: (page: Response) => Promise<Response>;
    routesReady: () => Promise<void>;
    routeName: (request: Request) => string | undefined;
};
/**
 * A queue consumer, or a scheduled of its own in place of `cron`.
 */
export type SiteHandlers<E> = Pick<ExportedHandler<E, any>, "queue" | "scheduled" | "email">;
import { SECURITY_TXT_PATH } from "./worker-site.mjs";
import type { AdminSettings } from "./access.mjs";
import type { AccessSecrets } from "./access.mjs";
import type { RouterContextProvider } from "react-router";
import type { ServerBuild } from "react-router";
import type { OperatorTool } from "./operator.mjs";
import type { Preload } from "./preload.mjs";
import type { Preconnect } from "./preload.mjs";
import type { CronJob } from "./cron.mjs";
export { defineSite, siteRenderer } from "./worker-site.mjs";
