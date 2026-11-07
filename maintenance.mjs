/**
 * The maintenance page, once, for every site: a 503 with `Retry-After`, a plain page and no cache, so a crawler comes
 * back instead of dropping the address and no browser or proxy keeps the notice after the site is back (MDN, 503
 * Service Unavailable). A site is in maintenance when its `MAINTENANCE` var is "1" or "true"; the owner sets it in the
 * dashboard or a deploy, never in code, so turning it off needs no release.
 *
 * Self-contained on purpose: it renders with the app down, so it reads no database, loader or stylesheet. It carries
 * no inline style (a site's Content-Security-Policy would block one), so it keeps the browser's own type and honors
 * the reader's light or dark setting through `color-scheme`.
 */

import { escapeHtml } from "./html.mjs";

/** Seconds a reader or crawler is told to wait: an hour. */
export const MAINTENANCE_RETRY_AFTER = 3600;

/**
 * True when the site is in maintenance.
 * @param {{ MAINTENANCE?: unknown } | undefined} env
 * @returns {boolean}
 */
export function maintenanceOn(env) {
  const value = String(env?.MAINTENANCE ?? "")
    .trim()
    .toLowerCase();
  return value === "1" || value === "true";
}

/**
 * The 503 maintenance response. `siteName` is the site's name in the title and heading.
 * @param {{ siteName?: string, retryAfter?: number, text?: string }} [options]
 * @returns {Response}
 */
export function maintenanceResponse({
  siteName = "This site",
  retryAfter = MAINTENANCE_RETRY_AFTER,
  text = "It is down for maintenance and will be back soon. Please try again in a little while.",
} = {}) {
  const name = escapeHtml(siteName);
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>Down for maintenance | ${name}</title>
</head>
<body>
<main id="main">
<h1>Down for maintenance</h1>
<p>${escapeHtml(text)}</p>
</main>
</body>
</html>
`;
  return new Response(body, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Retry-After": String(Math.max(1, Math.round(retryAfter))),
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
