/**
 * Starts the page: the default policy now, INP reporting once the page has loaded. Returns false when this page had already started.
 * @param {{ endpoint?: string }} [options] the report receiver: CSP_REPORT_PATH (/csp-report) unless the site's is elsewhere
 */
export function startPage(options?: {
    endpoint?: string;
}): boolean;
