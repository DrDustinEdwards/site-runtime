/**
 * The one call every client entry makes first, so every page starts the same way: the Trusted Types default policy
 * (./trusted-types) and INP attribution (./vitals-client). A site with several entries on one page (an island per
 * widget, a framework entry beside a plain site script) calls it in each; the second call does nothing.
 *
 * It also tells Zod, where a site's client code uses it, never to try compiling code. Zod 4 probes whether it may
 * compile its parsers with a caught `new Function("")`, and skips the probe when its global config says `jitless`
 * (zod v4/core/util.js, allowsEval; core.js keeps the config at globalThis.__zod_globalConfig, which `z.config()`
 * writes). Every site's policy refuses script text (no 'unsafe-eval', and the default policy refuses createScript), so
 * the probe can only fail, and each try is a Content-Security-Policy report. Either order works: if Zod loaded first,
 * this sets the flag on Zod's own config object, and Zod runs the probe only at its first parse, after startPage().
 */

import { installTrustedTypes } from "./trusted-types.mjs";

const STARTED = Symbol.for("@dustinedwards/site-runtime/page-client");

/**
 * Starts the page: the default policy now, INP reporting once the page has loaded. Returns false when this page had already started.
 * @param {{ endpoint?: string }} [options] the report receiver: CSP_REPORT_PATH (/csp-report) unless the site's is elsewhere
 */
export function startPage(options = {}) {
  const g = /** @type {Record<symbol, unknown>} */ (/** @type {unknown} */ (globalThis));
  if (g[STARTED]) return false;
  g[STARTED] = true;
  const zod = /** @type {{ __zod_globalConfig?: Record<string, unknown> }} */ (
    /** @type {unknown} */ (globalThis)
  );
  (zod.__zod_globalConfig ??= {}).jitless = true;
  installTrustedTypes(options);
  // INP reporting loads after the page has: web-vitals reads the buffered entries, so it "does not need to load early"
  // and "should be deferred until after other user-impacting code has loaded" (web-vitals README, "Overview"). As its own
  // chunk it stays out of every page's first download (about 4 KB gzip). A chunk that fails to load costs only the report.
  const inp = () => {
    import("./vitals-client.mjs").then(
      ({ reportInp }) => reportInp(options),
      () => {},
    );
  };
  if (document.readyState === "complete") inp();
  else addEventListener("load", inp, { once: true });
  return true;
}
