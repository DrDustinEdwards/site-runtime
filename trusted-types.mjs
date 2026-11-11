/**
 * The page's Trusted Types "default" policy, one for every site (W3C Trusted Types; web.dev, "Prevent DOM-based
 * cross-site scripting vulnerabilities with Trusted Types"; Chrome's Modern Web Guidance, trusted-types).
 *
 * Once a page's policy says `require-trusted-types-for 'script'`, a plain string given to an injection sink (innerHTML,
 * a script's src or text, eval) goes through the "default" policy, and is refused if there is none or it returns
 * nothing. Our own code never relies on it: markup goes in through a named policy (Capsomer's `markup()` and
 * `trustedHtml()`, Enarratio's parser, Turnstile's loader here) or is built as DOM. The default policy is the narrow
 * gate for what a library does that we cannot change:
 *
 * - HTML: React 19 makes a client-rendered <script> element with `innerHTML = "<script></script>"`
 *   (react-dom-client, createInstance). That exact string passes, and so does any string with no "<", which can make
 *   only text (React Router's JSON-LD on a client navigation, whose "<" is escaped). Anything else is escaped, so it shows as text and
 *   runs nothing, and is reported to the site's own receiver (./csp-report) once per sink and script, so the place can
 *   be fixed. Escaping rather than refusing keeps a page that missed one sink readable instead of breaking it.
 * - Script URLs: same-origin only (the site's own bundles). Any other origin is refused, and the browser reports it.
 * - Script text (eval, new Function, a script's text): always refused, and the browser reports it.
 *
 * Call `installTrustedTypes()` first in the client entry, before anything renders. Without Trusted Types in the
 * browser (Firefox before 148, Safari before 26) it does nothing. A page that already has a default policy keeps it.
 * The names a site's Content-Security-Policy lists are TRUSTED_TYPES_NAMES plus any of its own.
 */

import { CSP_REPORT_PATH } from "./csp.mjs";
import { escapeHtml } from "./html.mjs";

/** The string React 19 assigns to make a script element on the client. */
export const REACT_SCRIPT_STUB = "<script></script>";

/**
 * The policy names every site allows: this module's default, Capsomer's, Enarratio's and Turnstile's loader. A site
 * that uses DOMPurify's RETURN_TRUSTED_TYPE adds "dompurify".
 */
export const TRUSTED_TYPES_NAMES = Object.freeze(["default", "capsomer", "enarratio", "turnstile"]);

/**
 * The script position that called the sink: the stack's frames past the first `skip` (the reporter and createHTML,
 * which can sit in the same bundle as the caller, so frames are counted rather than matched by address).
 * @param {string | undefined} stack
 * @param {number} [skip]
 */
export function callerScript(stack, skip = 2) {
  const frames = [...String(stack ?? "").matchAll(/(https?:\/\/[^\s)]+?):(\d+):(\d+)/g)];
  const frame = frames[skip];
  return frame ? { url: frame[1], line: Number(frame[2]), column: Number(frame[3]) } : undefined;
}

/**
 * The Reporting API body for one escaped string, in the shape the receiver reads: the sink as the sample's first part
 * (never the string itself, which can be the page's own words), the page and the script that made the call.
 * @param {string} sink such as "Element innerHTML"
 * @param {string} page
 * @param {{ url: string, line: number, column: number } | undefined} caller
 */
export function escapedReport(sink, page, caller) {
  return [
    {
      type: "csp-violation",
      body: {
        documentURL: page,
        effectiveDirective: "trusted-types-default-policy",
        blockedURL: "trusted-types-sink",
        sample: `${sink}|`,
        disposition: "report",
        ...(caller
          ? { sourceFile: caller.url, lineNumber: caller.line, columnNumber: caller.column }
          : {}),
      },
    },
  ];
}

/**
 * The rules of the default policy. Exported for the test; a page uses `installTrustedTypes`.
 * @param {(sink: string) => void} report called with the sink when HTML is escaped
 * @param {string} origin the page's origin
 */
export function defaultRules(report, origin) {
  return {
    /** @param {string} html @param {unknown} _type @param {string} sink */
    createHTML(html, _type, sink) {
      // Markup with no "<" can make only text (the fragment parser starts an element only at "<"), so it is inert as
      // written: React Router's JSON-LD (escaped to \u003c) and plain text.
      if (html === REACT_SCRIPT_STUB || !html.includes("<")) return html;
      report(sink || "unknown sink");
      return escapeHtml(html);
    },
    /** @param {string} url */
    createScriptURL(url) {
      try {
        return new URL(url, origin).origin === origin ? url : null;
      } catch {
        return null;
      }
    },
    createScript: () => null,
  };
}

/**
 * Creates the page's "default" policy. Returns false when the browser has no Trusted Types or the page already has one.
 * @param {{ endpoint?: string }} [options] where escaped strings are reported: CSP_REPORT_PATH (/csp-report) unless the
 *   site's receiver is elsewhere.
 */
export function installTrustedTypes({ endpoint = CSP_REPORT_PATH } = {}) {
  const factory = /** @type {any} */ (globalThis).trustedTypes;
  if (!factory || factory.defaultPolicy) return false;
  /** @type {Set<string>} */
  const sent = new Set();
  const report = (/** @type {string} */ sink) => {
    const caller = callerScript(new Error().stack);
    const key = `${sink} ${caller?.url ?? ""}`;
    if (sent.has(key) || sent.size >= 20) return;
    sent.add(key);
    const body = JSON.stringify(escapedReport(sink, location.href, caller));
    navigator.sendBeacon(endpoint, new Blob([body], { type: "application/reports+json" }));
  };
  factory.createPolicy("default", defaultRules(report, location.origin));
  return true;
}
