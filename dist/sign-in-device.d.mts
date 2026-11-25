/**
 * The browser and system a user agent names ("Safari on iPhone", "Chrome on Windows"), one of them
 * alone when only one is known, or null. An iPad that asks for the desktop site says Macintosh, so it reads as a Mac.
 * @param {string | null | undefined} userAgent
 * @returns {string | null}
 */
export function deviceName(userAgent: string | null | undefined): string | null;
/**
 * The city, region and country Cloudflare placed a request in (`request.cf`), as words ("Portland, Oregon, United States"),
 * or null outside Workers and for a request built by the site.
 * @param {Request & { cf?: { city?: unknown, region?: unknown, country?: unknown } } | null | undefined} request
 * @returns {string | null}
 */
export function coarseLocation(request: (Request & {
    cf?: {
        city?: unknown;
        region?: unknown;
        country?: unknown;
    };
}) | null | undefined): string | null;
