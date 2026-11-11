/**
 * The one call every client entry makes first, so every page starts the same way: the Trusted Types default policy
 * (./trusted-types) and INP attribution (./vitals-client). A site with several entries on one page (an island per
 * widget, a framework entry beside a plain site script) calls it in each; the second call does nothing.
 */

import { installTrustedTypes } from "./trusted-types.mjs";
import { reportInp } from "./vitals-client.mjs";

const STARTED = Symbol.for("@dustinedwards/site-runtime/page-client");

/**
 * Starts the page: the default policy, then INP reporting. Returns false when this page had already started.
 * @param {{ endpoint?: string }} [options] the report receiver: CSP_REPORT_PATH (/csp-report) unless the site's is elsewhere
 */
export function startPage(options = {}) {
  const g = /** @type {Record<symbol, unknown>} */ (/** @type {unknown} */ (globalThis));
  if (g[STARTED]) return false;
  g[STARTED] = true;
  installTrustedTypes(options);
  reportInp(options);
  return true;
}
