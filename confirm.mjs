/**
 * A destructive request carries its confirmation (devkit-destructive). A guard in the page's own script is gone for a
 * reader without JavaScript while the destruction is not, so the action itself refuses what was not confirmed.
 *
 * The page asks (Capsomer's confirm dialog, or its confirm page for a plain form) and posts `confirmed=1`; the typed
 * word, where the page asks for one, posts as `confirm` (Capsomer's confirm page). devkit-destructive finds the call
 * by the name `confirmationSatisfied` inside each destructive intent's branch.
 */

/**
 * Whether the request says the person confirmed: `confirmed=1`, and the typed word (any case, trimmed) when the page
 * asked for one.
 *
 * @param {{ get(name: string): unknown }} form
 * @param {string} [word] the word the page asked to be typed
 * @returns {boolean}
 */
export function confirmationSatisfied(form, word) {
  if (form.get("confirmed") !== "1") return false;
  if (word === undefined) return true;
  return (
    String(form.get("confirm") ?? "")
      .trim()
      .toLowerCase() === word.toLowerCase()
  );
}

/**
 * The refusal for a destructive request that was not confirmed: a 400 that says nothing was changed.
 *
 * @returns {Response}
 */
export function confirmationRequired() {
  return new Response("Confirm this change first. Nothing was changed.", { status: 400 });
}
