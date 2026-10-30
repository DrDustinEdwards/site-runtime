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

export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

// render=explicit: the script must not scan the page for .cf-turnstile and render a second widget of its own.
const SCRIPT_URL = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`;

/**
 * @typedef {{
 *   render: (el: HTMLElement, options: { sitekey: string, size?: string, callback?: (token: string) => void }) => string,
 *   remove: (widgetId: string) => void,
 * }} Turnstile
 */

/** @type {Promise<Turnstile> | undefined} */
let loading;

/** @returns {Promise<Turnstile>} */
function loadTurnstile() {
  const ready = /** @type {{ turnstile?: Turnstile }} */ (globalThis).turnstile;
  if (ready) return Promise.resolve(ready);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve(/** @type {Turnstile} */ (/** @type {{ turnstile?: Turnstile }} */ (globalThis).turnstile));
    script.onerror = () => {
      // Forgotten, so the next mount tries again rather than waiting on a script that never came.
      loading = undefined;
      script.remove();
      reject(new Error("Turnstile's script did not load"));
    };
    document.head.append(script);
  });
  return loading;
}

/**
 * Renders the widget into `el` once the script has loaded. The returned function removes it; called before the script
 * loads, nothing is ever rendered (a React effect cleaned up on a quick re-render).
 * @param {HTMLElement} el
 * @param {string} siteKey
 * @param {{ onToken?: (token: string) => void }} [options]
 * @returns {() => void}
 */
export function mountTurnstile(el, siteKey, options = {}) {
  /** @type {string | undefined} */
  let widgetId;
  let removed = false;
  loadTurnstile().then(
    (turnstile) => {
      // flexible: as wide as the form (300px at least), not Cloudflare's fixed 300px box.
      if (!removed) widgetId = turnstile.render(el, { sitekey: siteKey, size: "flexible", callback: options.onToken });
    },
    (error) => console.error(error),
  );
  return () => {
    removed = true;
    if (widgetId !== undefined) /** @type {{ turnstile?: Turnstile }} */ (globalThis).turnstile?.remove(widgetId);
  };
}

/** Cloudflare's server-side check of a widget token. */
export const SITEVERIFY_URL = `${TURNSTILE_ORIGIN}/turnstile/v0/siteverify`;

/** Cloudflare's own limit on a token's length (developers.cloudflare.com/turnstile/get-started/server-side-validation). */
const MAX_TOKEN_LENGTH = 2048;

/**
 * Checks a widget token with siteverify. Fails closed: every path but Cloudflare's `success: true` (and, when given,
 * the expected `hostname` and `action`) is `ok: false`, with Cloudflare's error codes or one of ours (`missing-secret`,
 * `missing-input-response`, `siteverify-unreachable`, `hostname-mismatch`, `action-mismatch`). Never throws.
 * @param {string | null | undefined} token
 * @param {string | null | undefined} secret
 * @param {{ remoteIp?: string | null, hostname?: string, action?: string, timeoutMs?: number, fetch?: typeof fetch }} [options]
 * @returns {Promise<{ ok: boolean, errors: string[], hostname?: string, action?: string }>}
 */
export async function verifyTurnstile(token, secret, { remoteIp, hostname, action, timeoutMs = 10_000, fetch: post = fetch } = {}) {
  if (!secret) return { ok: false, errors: ["missing-secret"] };
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, errors: ["missing-input-response"] };
  }
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);
  /** @type {{ success?: unknown, "error-codes"?: unknown, hostname?: unknown, action?: unknown }} */
  let answer;
  try {
    const res = await post(SITEVERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { ok: false, errors: ["siteverify-unreachable"] };
    answer = await res.json();
  } catch {
    return { ok: false, errors: ["siteverify-unreachable"] };
  }
  const errors = Array.isArray(answer?.["error-codes"]) ? answer["error-codes"].map(String) : [];
  const seen = {
    ...(typeof answer?.hostname === "string" ? { hostname: answer.hostname } : {}),
    ...(typeof answer?.action === "string" ? { action: answer.action } : {}),
  };
  if (answer?.success !== true) return { ok: false, errors: errors.length ? errors : ["not-success"], ...seen };
  if (hostname !== undefined && seen.hostname !== hostname) return { ok: false, errors: ["hostname-mismatch"], ...seen };
  if (action !== undefined && seen.action !== action) return { ok: false, errors: ["action-mismatch"], ...seen };
  return { ok: true, errors: [], ...seen };
}
