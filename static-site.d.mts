/** The Worker in front of a static site's assets (static-site.mjs). */

import type { speculationRules } from "./prefetch.mjs";
import type { canonicalRedirect } from "./url.mjs";
import type { SiteEntry } from "./sites.mjs";

export interface StaticSiteEnv {
  readonly ASSETS: { fetch(request: Request): Promise<Response> };
  readonly CSP_REPORT_RATE_LIMIT?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

export interface StaticSiteOptions {
  /** The site's registry entry, whose set (staticHeaders) its `_headers` file was written from. */
  site?: SiteEntry;
  /** With `site`, what the site adds to that set; without it, the whole set. */
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

/**
 * A site's headers from its registry entry: `set`, what every response carries (with `headers` added), and `file`, the
 * `_headers` text site-runtime-headers writes (the set, charset and CORP per type, a static site's page policy and
 * staged Report-Only policy, and the entry's path rules).
 */
export function staticHeaders(entry: SiteEntry, options?: { headers?: Readonly<Record<string, string>> }): { set: Record<string, string>; file: string };

/** The fetch handler: canonical redirect, reports, prefetch rules, then the asset with the page headers. */
export function staticSite(options?: StaticSiteOptions): { fetch(request: Request, env: StaticSiteEnv): Promise<Response> };
