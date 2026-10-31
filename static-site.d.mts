/** The Worker in front of a static site's assets (static-site.mjs). */

import type { speculationRules } from "./prefetch.mjs";
import type { canonicalRedirect } from "./url.mjs";

export interface StaticSiteEnv {
  readonly ASSETS: { fetch(request: Request): Promise<Response> };
  readonly CSP_REPORT_RATE_LIMIT?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

export interface StaticSiteOptions {
  /** The site's security set, the one its `_headers` file was written from. */
  headers?: Readonly<Record<string, string>>;
  /** The `Link` header value, `preloads(...).header`, sent on a 200 page. */
  preload?: string;
  /** Where Content-Security-Policy reports are received; null for none. Default /csp-report. */
  reportPath?: string | null;
  /** The prefetch rules' options, or false to serve none and send no Speculation-Rules header. */
  prefetch?: Parameters<typeof speculationRules>[0] | false;
  /** canonicalRedirect's options, or false to redirect nothing (a site whose files end in a slash). */
  canonical?: Parameters<typeof canonicalRedirect>[1] | false;
  /** The 404 page's path. Default /404. */
  notFound?: string;
}

/** The fetch handler: canonical redirect, reports, prefetch rules, then the asset with the page headers. */
export function staticSite(options?: StaticSiteOptions): { fetch(request: Request, env: StaticSiteEnv): Promise<Response> };
