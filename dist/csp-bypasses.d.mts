/**
 * The known allowlist bypass a script source would let in, or undefined: csp-evaluator's own match
 * (utils.ts matchWildcardUrls). A host source matches a listed URL on the same host (any subdomain, for a wildcard
 * host); with a path, only a listed URL under that path prefix (a path ending in "/") or at that exact path.
 * @param {string} source
 * @returns {string | undefined} the listed URL, scheme-relative
 */
export function allowlistBypass(source: string): string | undefined;
