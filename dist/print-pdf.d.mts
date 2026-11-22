/**
 * A Paged.js page's content, wrapped in the template Paged.js reads it from (`<template data-ref="pagedjs-content">`),
 * so the polyfill never copies the body through innerHTML. Put it first in the body, before `pagedScripts`.
 * @param {string} html the page's content markup
 */
export function pagedContent(html: string): string;
/**
 * The closing scripts of a Paged.js page: the config, then the self-hosted polyfill with its integrity hash (a page
 * previewed with a signed-in session must not run a changed file).
 * @param {{ path: string, integrity: string }} polyfill
 */
export function pagedScripts({ path, integrity }: {
    path: string;
    integrity: string;
}): string;
/**
 * A PDF through the quick action. Throws, naming what failed: no binding, a refusal, or bytes that are not a PDF.
 * @param {{ quickAction(action: "pdf", options: Record<string, unknown>): Promise<Response> } | undefined} browser
 * @param {string} html
 * @param {{ what?: string, pdfOptions?: Record<string, unknown>, gotoOptions?: Record<string, unknown> }} [options]
 * @returns {Promise<Uint8Array<ArrayBuffer>>}
 */
export function quickPdf(browser: {
    quickAction(action: "pdf", options: Record<string, unknown>): Promise<Response>;
} | undefined, html: string, { what, pdfOptions, gotoOptions }?: {
    what?: string;
    pdfOptions?: Record<string, unknown>;
    gotoOptions?: Record<string, unknown>;
}): Promise<Uint8Array<ArrayBuffer>>;
/**
 * A PDF of a Paged.js page through a full browser. `origin` becomes the page's <base>, since the page has no address
 * of its own and names its scripts and fonts by path. Waits for the network, the fonts and Paged.js's completion mark,
 * then prints with the page's own @page size; the whole render is bounded by `timeoutMs`.
 * @param {{ launch(binding: never): Promise<any> }} puppeteer the site's `@cloudflare/puppeteer` default export
 * @param {unknown} browserBinding env.BROWSER
 * @param {string} html
 * @param {{ origin: string, what?: string, timeoutMs?: number, loadTimeoutMs?: number, pagedTimeoutMs?: number, pdfOptions?: Record<string, unknown> }} options
 * @returns {Promise<Uint8Array>}
 */
export function pagedPdf(puppeteer: {
    launch(binding: never): Promise<any>;
}, browserBinding: unknown, html: string, { origin, what, timeoutMs, loadTimeoutMs, pagedTimeoutMs, pdfOptions, }: {
    origin: string;
    what?: string;
    timeoutMs?: number;
    loadTimeoutMs?: number;
    pagedTimeoutMs?: number;
    pdfOptions?: Record<string, unknown>;
}): Promise<Uint8Array>;
/** The attribute Paged.js's `after` hook sets on <html> when it has laid out every page. */
export const PAGED_DONE_ATTRIBUTE: "data-pagedjs-done";
/**
 * Paged.js 0.4.3's page frame, exactly as the polyfill assigns it to a <template>'s innerHTML for every page (its
 * TEMPLATE constant). The one markup string the book's Trusted Types policy lets through; a different Paged.js
 * version may write another, so a site that ships the polyfill checks its copy still contains this text.
 */
export const PAGED_JS_PAGE_TEMPLATE: "\n<div class=\"pagedjs_page\">\n\t<div class=\"pagedjs_sheet\">\n\t\t<div class=\"pagedjs_bleed pagedjs_bleed-top\">\n\t\t\t<div class=\"pagedjs_marks-crop\"></div>\n\t\t\t<div class=\"pagedjs_marks-middle\">\n\t\t\t\t<div class=\"pagedjs_marks-cross\"></div>\n\t\t\t</div>\n\t\t\t<div class=\"pagedjs_marks-crop\"></div>\n\t\t</div>\n\t\t<div class=\"pagedjs_bleed pagedjs_bleed-bottom\">\n\t\t\t<div class=\"pagedjs_marks-crop\"></div>\n\t\t\t<div class=\"pagedjs_marks-middle\">\n\t\t\t\t<div class=\"pagedjs_marks-cross\"></div>\n\t\t\t</div>\t\t<div class=\"pagedjs_marks-crop\"></div>\n\t\t</div>\n\t\t<div class=\"pagedjs_bleed pagedjs_bleed-left\">\n\t\t\t<div class=\"pagedjs_marks-crop\"></div>\n\t\t\t<div class=\"pagedjs_marks-middle\">\n\t\t\t\t<div class=\"pagedjs_marks-cross\"></div>\n\t\t\t</div>\t\t<div class=\"pagedjs_marks-crop\"></div>\n\t\t</div>\n\t\t<div class=\"pagedjs_bleed pagedjs_bleed-right\">\n\t\t\t<div class=\"pagedjs_marks-crop\"></div>\n\t\t\t<div class=\"pagedjs_marks-middle\">\n\t\t\t\t<div class=\"pagedjs_marks-cross\"></div>\n\t\t\t</div>\n\t\t\t<div class=\"pagedjs_marks-crop\"></div>\n\t\t</div>\n\t\t<div class=\"pagedjs_pagebox\">\n\t\t\t<div class=\"pagedjs_margin-top-left-corner-holder\">\n\t\t\t\t<div class=\"pagedjs_margin pagedjs_margin-top-left-corner\"><div class=\"pagedjs_margin-content\"></div></div>\n\t\t\t</div>\n\t\t\t<div class=\"pagedjs_margin-top\">\n\t\t\t\t<div class=\"pagedjs_margin pagedjs_margin-top-left\"><div class=\"pagedjs_margin-content\"></div></div>\n\t\t\t\t<div class=\"pagedjs_margin pagedjs_margin-top-center\"><div class=\"pagedjs_margin-content\"></div></div>\n\t\t\t\t<div class=\"pagedjs_margin pagedjs_margin-top-right\"><div class=\"pagedjs_margin-content\"></div></div>\n\t\t\t</div>\n\t\t\t<div class=\"pagedjs_margin-top-right-corner-holder\">\n\t\t\t\t<div class=\"pagedjs_margin pagedjs_margin-top-right-corner\"><div class=\"pagedjs_margin-content\"></div></div>\n\t\t\t</div>\n\t\t\t<div class=\"pagedjs_margin-right\">\n\t\t\t\t<div class=\"pagedjs_margin pagedjs_margin-right-top\"><div class=\"pagedjs_margin-content\"></div></div>\n\t\t\t\t<div class=\"pagedjs_margin pagedjs_margin-right-middle\"><div class=\"pagedjs_margin-content\"></div></div>\n\t\t\t\t<div class=\"pagedjs_margin pagedjs_margin-right-bottom\"><div class=\"pagedjs_margin-content\"></div></div>\n\t\t\t</div>\n\t\t\t<div class=\"pagedjs_margin-left\">\n\t\t\t\t<div class=\"pagedjs_margin pagedjs_margin-left-top\"><div class=\"pagedjs_margin-content\"></div></div>\n\t\t\t\t<div class=\"pagedjs_margin pagedjs_margin-left-middle\"><div class=\"pagedjs_margin-content\"></div></div>\n\t\t\t\t<div class=\"pagedjs_margin pagedjs_margin-left-bottom\"><div class=\"pagedjs_margin-content\"></div></div>\n\t\t\t</div>\n\t\t\t<div class=\"pagedjs_margin-bottom-left-corner-holder\">\n\t\t\t\t<div class=\"pagedjs_margin pagedjs_margin-bottom-left-corner\"><div class=\"pagedjs_margin-content\"></div></div>\n\t\t\t</div>\n\t\t\t<div class=\"pagedjs_margin-bottom\">\n\t\t\t\t<div class=\"pagedjs_margin pagedjs_margin-bottom-left\"><div class=\"pagedjs_margin-content\"></div></div>\n\t\t\t\t<div class=\"pagedjs_margin pagedjs_margin-bottom-center\"><div class=\"pagedjs_margin-content\"></div></div>\n\t\t\t\t<div class=\"pagedjs_margin pagedjs_margin-bottom-right\"><div class=\"pagedjs_margin-content\"></div></div>\n\t\t\t</div>\n\t\t\t<div class=\"pagedjs_margin-bottom-right-corner-holder\">\n\t\t\t\t<div class=\"pagedjs_margin pagedjs_margin-bottom-right-corner\"><div class=\"pagedjs_margin-content\"></div></div>\n\t\t\t</div>\n\t\t\t<div class=\"pagedjs_area\">\n\t\t\t\t<div class=\"pagedjs_page_content\"></div>\n\t\t\t\t<div class=\"pagedjs_footnote_area\">\n\t\t\t\t\t<div class=\"pagedjs_footnote_content pagedjs_footnote_empty\">\n\t\t\t\t\t\t<div class=\"pagedjs_footnote_inner_content\"></div>\n\t\t\t\t\t</div>\n\t\t\t\t</div>\n\t\t\t</div>\n\t\t</div>\n\t</div>\n</div>";
/**
 * The config script a Paged.js page runs before the polyfill: auto layout, the completion mark the render waits on,
 * and the page's Trusted Types "default" policy. Paged.js writes two strings to injection sinks: its page frame
 * (PAGED_JS_PAGE_TEMPLATE) and "" to clear a running element. The policy passes exactly those and refuses everything
 * else, so a page can enforce `require-trusted-types-for 'script'` with `trusted-types default`. Paged.js also copies
 * the body into a template through innerHTML unless the content is already in one, which `pagedContent` does. Its
 * text is fixed so a page's CSP can trust it by hash.
 */
export const PAGED_JS_CONFIG: string;
/** The Trusted Types policy names a Paged.js page's Content-Security-Policy lists: only the config's default. */
export const PAGED_JS_TRUSTED_TYPES: readonly string[];
