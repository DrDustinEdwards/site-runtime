/**
 * The findings for one site. Throws when the site does not answer, so an outage never reads as findings.
 * @param {{ origin: string, from?: string, probes?: import("./sites.mjs").SignInProbes }} site `probes` in place of the
 *   registry entry's `signIn`
 * @returns {Promise<{ findings: Finding[], found: string[] }>}
 */
export function signInFindings({ origin, from, probes }: {
    origin: string;
    from?: string;
    probes?: import("./sites.mjs").SignInProbes;
}): Promise<{
    findings: Finding[];
    found: string[];
}>;
export type Got = {
    url: string;
    status: number;
    headers: Headers;
    cookies: string[];
    body: string;
    error?: string;
};
export type Finding = {
    item: string;
    severity: "error" | "warning";
    url: string;
    detail: string;
};
