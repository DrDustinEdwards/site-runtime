/**
 * /.well-known/security.txt graded against RFC 9116: served 200 as `text/plain; charset=utf-8` (D1), one Contact and
 * exactly one Expires under a year out (D2), a warning 30 days before it (D4), and a Canonical naming the URL it is
 * served from or the site's own (D3). A signed file must carry its whole signature block; an unsigned one is the
 * family's deviation (FAMILY_DEVIATIONS.D3).
 * @param {{ url: string, origin?: string, status: number, headers: Headers, body: string, now?: number }} response
 *   `url` where it was fetched; `origin` the site's own, when it is served from elsewhere
 * @param {{ site?: string | CheckedSiteEntry }} [options]
 */
export function checkSecurityTxt({ url, origin, status, headers, body, now }: {
    url: string;
    origin?: string;
    status: number;
    headers: Headers;
    body: string;
    now?: number;
}, { site }?: {
    site?: string | CheckedSiteEntry;
}): CheckResult[];
import type { CheckedSiteEntry } from "./check-core.mjs";
import type { CheckResult } from "./check-core.mjs";
