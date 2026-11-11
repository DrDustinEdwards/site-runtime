/**
 * The browser half of INP attribution: the page's slowest interaction (web-vitals, attribution build) sent once to the
 * site's own report receiver (./csp-report) as a Reporting API `web-vital` entry. Nothing leaves the site's origin.
 */
import type { INPMetricWithAttribution } from "web-vitals/attribution";

/** The beacon body for one INP report, in the Reporting API's array shape the receiver reads. */
export function inpEntry(
  metric: INPMetricWithAttribution,
  page: string,
): Array<{ type: "web-vital"; body: Record<string, unknown> }>;

/** Starts INP attribution for this page. Call once, from the site's client entry. `endpoint` defaults to /csp-report. */
export function reportInp(options?: { endpoint?: string }): void;
