/**
 * Cloudflare Turnstile, the bot check on a site's public forms that send email (txasm's sign-in link, Foxing's sign-up).
 * One loader for the widget, so no site keeps its own copy.
 *
 * - `TURNSTILE_ORIGIN` is what a site lists under `script` and `frame` in its Content-Security-Policy sources.
 * - `mountTurnstile(el, siteKey)` loads Cloudflare's script once per page, renders the widget into `el` and returns a
 *   function that removes it. Browser only: call it from an effect, never during a server render.
 * - The widget puts its token in a hidden `cf-turnstile-response` input inside `el`, so a form that holds `el` sends the
 *   token with its other fields. `onToken` is for a form that sends it another way (Better Auth's x-captcha-response header).
 * - The token is checked on the server, never here: `./sign-in` turns on Better Auth's captcha plugin for the email link.
 */

export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

// render=explicit: the script must not scan the page for .cf-turnstile and render a second widget of its own.
const SCRIPT_URL = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`;

/**
 * @typedef {{
 *   render: (el: HTMLElement, options: { sitekey: string, callback?: (token: string) => void }) => string,
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
      if (!removed) widgetId = turnstile.render(el, { sitekey: siteKey, callback: options.onToken });
    },
    (error) => console.error(error),
  );
  return () => {
    removed = true;
    if (widgetId !== undefined) /** @type {{ turnstile?: Turnstile }} */ (globalThis).turnstile?.remove(widgetId);
  };
}
