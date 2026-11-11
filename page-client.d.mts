/** The one call every client entry makes first: the Trusted Types default policy, then INP reporting. */

/** Starts the page; false when this page had already started (a second entry on the same page). */
export function startPage(options?: { endpoint?: string }): boolean;
