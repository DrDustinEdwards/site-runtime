/**
 * The browser half of INP attribution: the page's slowest interaction, measured by Google's web-vitals library
 * (attribution build), sent once to the site's own report receiver (./csp-report, CSP_REPORT_PATH) as a Reporting API
 * `web-vital` entry. Chrome's Modern Web Guidance (identify-inp-causes) and web.dev ("Find slow interactions in the
 * field") ask for exactly this: the INP value, its subparts (input delay, processing, presentation delay) and the longest
 * script the Long Animation Frames API saw, beaconed to an endpoint rather than logged in the page.
 *
 * Nothing leaves the site's own origin, so `connect-src 'self'` covers it and no third party sees a page address. What is
 * sent is the page's address (the receiver keeps origin and path), timings, a CSS selector of the element the visitor
 * used, and the script's address and function name: no text, no identifier, no cookie.
 *
 * Event Timing is Baseline 2025 (Safari 26.2); where it is missing, web-vitals reports nothing and nothing is sent. The
 * Long Animation Frames fields exist in Chromium only and are left out elsewhere; the subparts still come.
 */

import { onINP } from "web-vitals/attribution";

import { CSP_REPORT_PATH } from "./csp.mjs";

/**
 * The beacon body for one INP report, in the Reporting API's array shape the receiver reads.
 * @param {import("web-vitals/attribution").INPMetricWithAttribution} metric
 * @param {string} page
 */
export function inpEntry(metric, page) {
  const { attribution: a } = metric;
  const script = a.longestScript;
  return [
    {
      type: "web-vital",
      body: {
        name: "INP",
        value: metric.value,
        rating: metric.rating,
        page,
        target: a.interactionTarget,
        inputDelay: a.inputDelay,
        processingDuration: a.processingDuration,
        presentationDelay: a.presentationDelay,
        sourceURL: script?.entry?.sourceURL,
        sourceFunctionName: script?.entry?.sourceFunctionName,
        sourceCharPosition: script?.entry?.sourceCharPosition,
        invokerType: script?.entry?.invokerType,
        subpart: script?.subpart,
        intersectingDuration: script?.intersectingDuration,
        forcedStyleAndLayoutDuration: script?.entry?.forcedStyleAndLayoutDuration,
        totalStyleAndLayoutDuration: a.totalStyleAndLayoutDuration,
      },
    },
  ];
}

/**
 * Starts INP attribution for this page. Call once, from the site's client entry.
 * @param {{ endpoint?: string }} [options] where to send it: CSP_REPORT_PATH (/csp-report) unless the site's receiver is
 *   elsewhere.
 */
export function reportInp({ endpoint = CSP_REPORT_PATH } = {}) {
  onINP((metric) => {
    const body = JSON.stringify(inpEntry(metric, location.href));
    navigator.sendBeacon(endpoint, new Blob([body], { type: "application/reports+json" }));
  });
}
