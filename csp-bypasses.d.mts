/** google/csp-evaluator's allowlist bypasses (JSONP, AngularJS, Flash), as scheme-relative URLs. */
export const ALLOWLIST_BYPASSES: readonly string[];
/** The csp-evaluator allowlist-bypass URL a script source would let in (scheme-relative), or undefined. */
export function allowlistBypass(source: string): string | undefined;
