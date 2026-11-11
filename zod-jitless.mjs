/**
 * Tells Zod never to try compiling code. Zod 4 builds an object schema's fast parser, and probes whether it may with a
 * caught `new Function("")`, the moment the schema is created, and it skips the probe when its global config says
 * `jitless` (zod v4/core/util.js, allowsEval; core.js keeps the config at globalThis.__zod_globalConfig). A site's
 * policy refuses script text, so the probe can only fail, and each try is a Content-Security-Policy report.
 *
 * Importing this module sets the flag. Import it before any module that builds a Zod schema when that module can run
 * ahead of `startPage()` (an island chunk that evaluates before the site script has). `startPage()` imports it too.
 */
(/** @type {{ __zod_globalConfig?: Record<string, unknown> }} */ (/** @type {unknown} */ (globalThis)).__zod_globalConfig ??= {}).jitless = true;

export {};
