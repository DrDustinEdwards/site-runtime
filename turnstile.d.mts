/** The Cloudflare Turnstile widget loader (turnstile.mjs). */
/** The origin a site lists under `script` and `frame` in its Content-Security-Policy sources. */
export const TURNSTILE_ORIGIN: "https://challenges.cloudflare.com";
/**
 * Loads Cloudflare's script once per page and renders the widget into `el`, which then holds a hidden
 * `cf-turnstile-response` input. Returns a function that removes the widget; called before the script loads, nothing is
 * rendered. Browser only.
 */
export function mountTurnstile(el: HTMLElement, siteKey: string, options?: { onToken?: (token: string) => void }): () => void;
