/**
 * The beacon body for one INP report, in the Reporting API's array shape the receiver reads.
 * @param {import("web-vitals/attribution").INPMetricWithAttribution} metric
 * @param {string} page
 * @returns {Array<{ type: "web-vital"; body: Record<string, unknown> }>}
 */
export function inpEntry(metric: import("web-vitals/attribution").INPMetricWithAttribution, page: string): Array<{
    type: "web-vital";
    body: Record<string, unknown>;
}>;
/**
 * Starts INP attribution for this page. Call once, from the site's client entry.
 * @param {{ endpoint?: string }} [options] where to send it: CSP_REPORT_PATH (/csp-report) unless the site's receiver is
 *   elsewhere.
 */
export function reportInp({ endpoint }?: {
    endpoint?: string;
}): void;
