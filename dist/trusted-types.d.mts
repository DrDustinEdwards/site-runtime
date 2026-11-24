/**
 * Lets the default policy pass whole-document parses (DOMParser's parseFromString) unchanged until the returned
 * function is called. Holds stack: each caller releases its own, and releasing twice does nothing.
 * @returns {() => void}
 */
export function allowDocumentParsing(): () => void;
/**
 * The script position that called the sink: the stack's frames past the first `skip` (the reporter and createHTML,
 * which can sit in the same bundle as the caller, so frames are counted rather than matched by address).
 * @param {string | undefined} stack
 * @param {number} [skip]
 */
export function callerScript(stack: string | undefined, skip?: number): {
    url: string;
    line: number;
    column: number;
} | undefined;
/**
 * The Reporting API body for one escaped string, in the shape the receiver reads: the sink as the sample's first part
 * (never the string itself, which can be the page's own words), the page and the script that made the call.
 * @param {string} sink such as "Element innerHTML"
 * @param {string} page
 * @param {{ url: string, line: number, column: number } | undefined} caller
 * @returns {Array<{ type: "csp-violation"; body: Record<string, unknown> }>}
 */
export function escapedReport(sink: string, page: string, caller: {
    url: string;
    line: number;
    column: number;
} | undefined): Array<{
    type: "csp-violation";
    body: Record<string, unknown>;
}>;
/**
 * The rules of the default policy. Exported for the test; a page uses `installTrustedTypes`.
 * @param {(sink: string) => void} report called with the sink when HTML is escaped
 * @param {string} origin the page's origin
 * @param {(html: string, sink: string) => boolean} [allowHtml] the exact strings a library writes that a site lets pass
 */
export function defaultRules(report: (sink: string) => void, origin: string, allowHtml?: (html: string, sink: string) => boolean): {
    /** @param {string} html @param {unknown} _type @param {string} sink */
    createHTML(html: string, _type: unknown, sink: string): string;
    /** @param {string} url */
    createScriptURL(url: string): string | null;
    createScript: () => null;
};
/**
 * Creates the page's "default" policy. Returns false when the browser has no Trusted Types or the page already has one.
 * @param {{ endpoint?: string, target?: Window, allowHtml?: (html: string, sink: string) => boolean }} [options]
 *   `endpoint`: where escaped strings are reported,
 *   CSP_REPORT_PATH (/csp-report) unless the site's receiver is elsewhere. `target`: the window to give the policy, this
 *   one unless it is a same-origin frame the page builds (a blob: or about:blank frame inherits the page's
 *   Content-Security-Policy, so it needs a default policy of its own); its reports name the frame's page. `allowHtml`:
 *   the markup a library writes that may pass unescaped, matched exactly (a pattern with no room for an attribute or
 *   element of its own), for a frame or page whose library the site cannot change.
 */
export function installTrustedTypes({ endpoint, target, allowHtml, }?: {
    endpoint?: string;
    target?: Window;
    allowHtml?: (html: string, sink: string) => boolean;
}): boolean;
/** The string React 19 assigns to make a script element on the client. */
export const REACT_SCRIPT_STUB: "<script></script>";
/** The sink name the browser gives the default policy for DOMParser's parseFromString (Trusted Types, "DOMParser"). */
export const DOCUMENT_PARSE_SINK: "DOMParser parseFromString";
/**
 * The policy names every site allows: this module's default, Capsomer's, Enarratio's and Turnstile's loader. A site
 * that uses DOMPurify's RETURN_TRUSTED_TYPE adds "dompurify".
 */
export const TRUSTED_TYPES_NAMES: readonly string[];
