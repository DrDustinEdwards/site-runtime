/** The maintenance page: a 503 with Retry-After, no cache, for a site whose `MAINTENANCE` var is "1" or "true" (maintenance.mjs). */

/** 3600: seconds a reader or crawler is told to wait. */
export const MAINTENANCE_RETRY_AFTER: number;
/** True when `env.MAINTENANCE` is "1" or "true" (any case). */
export function maintenanceOn(env: { MAINTENANCE?: unknown } | undefined): boolean;
/** The 503 response: a plain self-contained page, `Retry-After`, `Cache-Control: private, no-store`, noindex. */
export function maintenanceResponse(options?: {
  siteName?: string;
  retryAfter?: number;
  text?: string;
}): Response;
