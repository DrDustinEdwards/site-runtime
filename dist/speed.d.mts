/**
 * @param {{ origin: string, base: string, kind: string, first: Got[], second: Got[], conditional: Got[], files: Got[],
 *   misses: Got[], hits: Got[], withCookie: Got, missing: Got[], campaign: Got, redirects: Record<string, { url: string, status: number }[]>,
 *   earlyHints: number[] | { error: string } | null, pagespeed: Record<string, any> }} o
 */
export function speedFindings(o: {
    origin: string;
    base: string;
    kind: string;
    first: Got[];
    second: Got[];
    conditional: Got[];
    files: Got[];
    misses: Got[];
    hits: Got[];
    withCookie: Got;
    missing: Got[];
    campaign: Got;
    redirects: Record<string, {
        url: string;
        status: number;
    }[]>;
    earlyHints: number[] | {
        error: string;
    } | null;
    pagespeed: Record<string, any>;
}): Finding[];
export type Got = {
    url: string;
    status: number;
    headers: Record<string, string>;
    ttfb: number;
    body: string;
    error?: string;
};
export type Finding = {
    item: string;
    severity: "error" | "warning" | "unmeasured";
    url: string;
    detail: string;
};
