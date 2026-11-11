/**
 * The page's Trusted Types "default" policy (trusted-types.mjs): React 19's script stub passes, other HTML is escaped
 * and reported, same-origin script URLs pass, script text is refused. Browser only.
 */

/** The string React 19 assigns to make a script element on the client. */
export const REACT_SCRIPT_STUB: "<script></script>";

/** The sink name the browser gives the default policy for DOMParser's parseFromString. */
export const DOCUMENT_PARSE_SINK: "DOMParser parseFromString";

/** Lets the default policy pass whole-document parses unchanged until the returned function is called. */
export function allowDocumentParsing(): () => void;

/** The policy names every site's `trusted-types` directive lists: default, capsomer, enarratio, turnstile. */
export const TRUSTED_TYPES_NAMES: readonly string[];

/** The script position that called the sink, past the first `skip` frames (default 2). */
export function callerScript(
  stack: string | undefined,
  skip?: number,
): { url: string; line: number; column: number } | undefined;

/** The Reporting API body for one escaped string: the sink, the page and the calling script, never the string. */
export function escapedReport(
  sink: string,
  page: string,
  caller: { url: string; line: number; column: number } | undefined,
): Array<{ type: "csp-violation"; body: Record<string, unknown> }>;

/** The default policy's rules. */
export function defaultRules(
  report: (sink: string) => void,
  origin: string,
  allowHtml?: (html: string, sink: string) => boolean,
): {
  createHTML(html: string, type: unknown, sink: string): string;
  createScriptURL(url: string): string | null;
  createScript(): null;
};

/** Creates the "default" policy; false when the browser has no Trusted Types or the page already has one. */
export function installTrustedTypes(options?: {
  endpoint?: string;
  target?: Window;
  allowHtml?: (html: string, sink: string) => boolean;
}): boolean;
