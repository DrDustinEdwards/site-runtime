/**
 * Renders the widget into `el` once the script has loaded. The returned function removes it; called before the script
 * loads, nothing is ever rendered (a React effect cleaned up on a quick re-render).
 * @param {HTMLElement} el
 * @param {string} siteKey
 * @param {{ onToken?: (token: string) => void }} [options]
 * @returns {() => void}
 */
export function mountTurnstile(el: HTMLElement, siteKey: string, options?: {
    onToken?: (token: string) => void;
}): () => void;
/**
 * Checks a widget token with siteverify. Fails closed: every path but Cloudflare's `success: true` (and, when given,
 * the expected `hostname` and `action`) is `ok: false`, with Cloudflare's error codes or one of ours (`missing-secret`,
 * `missing-input-response`, `siteverify-unreachable`, `hostname-mismatch`, `action-mismatch`). Never throws.
 * @param {string | null | undefined} token
 * @param {string | null | undefined} secret
 * @param {{ remoteIp?: string | null, hostname?: string, action?: string, timeoutMs?: number, fetch?: typeof fetch }} [options]
 * @returns {Promise<{ ok: boolean, errors: string[], hostname?: string, action?: string }>}
 */
export function verifyTurnstile(token: string | null | undefined, secret: string | null | undefined, { remoteIp, hostname, action, timeoutMs, fetch: post }?: {
    remoteIp?: string | null;
    hostname?: string;
    action?: string;
    timeoutMs?: number;
    fetch?: typeof fetch;
}): Promise<{
    ok: boolean;
    errors: string[];
    hostname?: string;
    action?: string;
}>;
/**
 * Cloudflare Turnstile, the bot check on a site's public forms that send email (txasm's sign-in link, Foxing's sign-up).
 * One loader for the widget, so no site keeps its own copy.
 *
 * - `TURNSTILE_ORIGIN` is what a site lists under `script` and `frame` in its Content-Security-Policy sources.
 * - `mountTurnstile(el, siteKey)` loads Cloudflare's script once per page, renders the widget into `el` and returns a
 *   function that removes it. Browser only: call it from an effect, never during a server render.
 * - The widget puts its token in a hidden `cf-turnstile-response` input inside `el`, so a form that holds `el` sends the
 *   token with its other fields. `onToken` is for a form that sends it another way (Better Auth's x-captcha-response header).
 * - The token is checked on the server: `./sign-in` turns on Better Auth's captcha plugin for the email link, and any other
 *   form checks it with `verifyTurnstile(token, secret, { remoteIp, hostname, action })`, which fails closed: no
 *   secret, no token, an unreachable or erroring siteverify, an answer that is not JSON, a hostname or action that is
 *   not the one expected, all are `ok: false`. Only `success: true` from Cloudflare passes. Never wrap it in a catch
 *   that returns a pass.
 */
export const TURNSTILE_ORIGIN: "https://challenges.cloudflare.com";
/** Cloudflare's server-side check of a widget token. */
export const SITEVERIFY_URL: "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export type Turnstile = {
    render: (el: HTMLElement, options: {
        sitekey: string;
        size?: string;
        callback?: (token: string) => void;
    }) => string;
    remove: (widgetId: string) => void;
};
