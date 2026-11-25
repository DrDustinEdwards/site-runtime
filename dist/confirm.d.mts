/**
 * Whether the request says the person confirmed: `confirmed=1`, and the typed word (any case, trimmed) when the page
 * asked for one.
 *
 * @param {{ get(name: string): unknown }} form
 * @param {string} [word] the word the page asked to be typed
 * @returns {boolean}
 */
export function confirmationSatisfied(form: {
    get(name: string): unknown;
}, word?: string): boolean;
/**
 * @returns {Response}
 */
export function confirmationRequired(): Response;
