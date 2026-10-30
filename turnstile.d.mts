/** The Cloudflare Turnstile widget loader (turnstile.mjs). */
/** The origin a site lists under `script` and `frame` in its Content-Security-Policy sources. */
export const TURNSTILE_ORIGIN: "https://challenges.cloudflare.com";
/**
 * Loads Cloudflare's script once per page and renders the widget into `el`, which then holds a hidden
 * `cf-turnstile-response` input. Returns a function that removes the widget; called before the script loads, nothing is
 * rendered. Browser only.
 */
export function mountTurnstile(el: HTMLElement, siteKey: string, options?: { onToken?: (token: string) => void }): () => void;

/** Cloudflare's server-side check of a widget token. */
export const SITEVERIFY_URL: "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/**
 * Checks a widget token on the server. Fails closed and never throws: only Cloudflare's `success: true`, with the
 * expected `hostname` and `action` when given, is `ok: true`. `errors` holds Cloudflare's codes or one of
 * `missing-secret`, `missing-input-response`, `siteverify-unreachable`, `not-success`, `hostname-mismatch`, `action-mismatch`.
 */
export function verifyTurnstile(
  token: string | null | undefined,
  secret: string | null | undefined,
  options?: { remoteIp?: string | null; hostname?: string; action?: string; timeoutMs?: number; fetch?: typeof fetch },
): Promise<{ ok: boolean; errors: string[]; hostname?: string; action?: string }>;
