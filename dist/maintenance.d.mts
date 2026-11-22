/**
 * True when the site is in maintenance.
 * @param {{ MAINTENANCE?: unknown } | undefined} env
 * @returns {boolean}
 */
export function maintenanceOn(env: {
    MAINTENANCE?: unknown;
} | undefined): boolean;
/**
 * The 503 maintenance response. `siteName` is the site's name in the title and heading.
 * @param {{ siteName?: string, retryAfter?: number, text?: string }} [options]
 * @returns {Response}
 */
export function maintenanceResponse({ siteName, retryAfter, text, }?: {
    siteName?: string;
    retryAfter?: number;
    text?: string;
}): Response;
/** Seconds a reader or crawler is told to wait: an hour. */
export const MAINTENANCE_RETRY_AFTER: 3600;
