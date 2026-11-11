/** HTML to PDF with Browser Rendering (print-pdf.mjs): the quick action, or a Paged.js page through puppeteer. */

export const PAGED_DONE_ATTRIBUTE: string;
/** Paged.js 0.4.3's page frame, the one markup string the config's Trusted Types policy passes. */
export const PAGED_JS_PAGE_TEMPLATE: string;
/** The fixed config script a Paged.js page runs before the polyfill, with its Trusted Types default policy (trust it by hash). */
export const PAGED_JS_CONFIG: string;
/** The Trusted Types names a Paged.js page's CSP lists. */
export const PAGED_JS_TRUSTED_TYPES: readonly string[];
/** The page's content inside the template Paged.js reads it from, so it is never copied through innerHTML. */
export function pagedContent(html: string): string;
/** The config and the self-hosted polyfill's script tag with its integrity hash. */
export function pagedScripts(polyfill: { path: string; integrity: string }): string;
/** A PDF through `BROWSER.quickAction("pdf")`; throws on no binding, a refusal or bytes that are not a PDF. */
export function quickPdf(
  browser:
    | { quickAction(action: "pdf", options: Record<string, unknown>): Promise<Response> }
    | undefined,
  html: string,
  options?: {
    what?: string;
    pdfOptions?: Record<string, unknown>;
    gotoOptions?: Record<string, unknown>;
  },
): Promise<Uint8Array<ArrayBuffer>>;
/** A PDF of a Paged.js page through the site's @cloudflare/puppeteer, waiting for fonts and Paged.js's mark. */
export function pagedPdf(
  puppeteer: { launch(binding: never): Promise<unknown> },
  browserBinding: unknown,
  html: string,
  options: {
    origin: string;
    what?: string;
    timeoutMs?: number;
    loadTimeoutMs?: number;
    pagedTimeoutMs?: number;
    pdfOptions?: Record<string, unknown>;
  },
): Promise<Uint8Array>;
