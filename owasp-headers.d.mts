/** Where these values were read, and when. */
export const OWASP_SOURCE: Readonly<{
  page: "https://owasp.org/www-project-secure-headers/";
  data: "https://github.com/OWASP/www-project-secure-headers/tree/master/ci";
  readOn: "2026-10-06";
  lastUpdateUtc: "2026-10-04 07:23:38";
}>;
/** The headers OSHP recommends a response carry, as OSHP writes them. */
export const OWASP_RECOMMENDED: Readonly<{
  "Cache-Control": "no-store, max-age=0";
  "Clear-Site-Data": '"cache","cookies","storage"';
  "Content-Security-Policy": "default-src 'self'; form-action 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests";
  "Cross-Origin-Embedder-Policy": "require-corp";
  "Cross-Origin-Opener-Policy": "same-origin";
  "Cross-Origin-Resource-Policy": "same-origin";
  "Permissions-Policy": "accelerometer=(), autoplay=(), camera=(), cross-origin-isolated=(), display-capture=(), encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), keyboard-map=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-get=(), screen-wake-lock=(), sync-xhr=(self), usb=(), web-share=(), xr-spatial-tracking=(), clipboard-read=(), clipboard-write=(), gamepad=(), hid=(), idle-detection=(), interest-cohort=(), serial=(), unload=()";
  "Referrer-Policy": "no-referrer";
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains";
  "X-Content-Type-Options": "nosniff";
  "X-DNS-Prefetch-Control": "off";
  "X-Frame-Options": "deny";
  "X-Permitted-Cross-Domain-Policies": "none";
}>;
/** The headers OSHP recommends a response not carry (they name the software that served it). */
export const OWASP_REMOVE: readonly string[];
