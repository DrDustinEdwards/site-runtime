/**
 * The rule set: same-origin links, minus `exclude` (path prefixes, added to `NEVER_PREFETCH`), links to files
 * (`FILE_EXTENSIONS`), links with a query string unless `excludeQueries` is false, downloads, links that open
 * elsewhere, `rel=nofollow` and anything marked `data-no-prefetch`.
 * @param {{ exclude?: string[], excludeQueries?: boolean, eagerness?: "conservative" | "moderate" | "eager", prerender?: boolean }} [options]
 */
export function speculationRules({ exclude, excludeQueries, eagerness, prerender, }?: {
    exclude?: string[];
    excludeQueries?: boolean;
    eagerness?: "conservative" | "moderate" | "eager";
    prerender?: boolean;
}): Record<string, unknown[]>;
/**
 * The response for `SPECULATION_RULES_PATH`: the rules, typed as browsers require, cached a day. Cloudflare compresses
 * only the types on its list, and application/speculationrules+json is not one, so with the `request` the response
 * names the encoding the browser accepts (./http acceptedEncoding) and the runtime encodes the body.
 * @param {Parameters<typeof speculationRules>[0]} [options]
 * @param {Request} [request]
 */
export function speculationRulesResponse(options?: Parameters<typeof speculationRules>[0], request?: Request): Response;
/**
 * @typedef {object} SpeculationOptions
 * @property {string[]} [exclude] More path prefixes to skip, such as "/drafts".
 * @property {boolean} [excludeQueries] Skip links with a query string (searches, filters, sized images). On by default; false prefetches them.
 * @property {"conservative" | "moderate" | "eager"} [eagerness] When to prefetch: moderate (pointer rests on the link, the default), conservative (on press) or eager.
 * @property {boolean} [prerender] Also prerender on press. Off by default: a prerendered page runs its scripts and analytics early.
 */
export const SPECULATION_RULES_PATH: "/speculation-rules.json";
/** The paths no site prefetches: its signed-in areas, its APIs and anything that acts on a GET. */
export const NEVER_PREFETCH: string[];
/**
 * The extensions no site prefetches: files a reader downloads or a reader's tool fetches (feeds, data, documents,
 * archives, media), never a page. A prefetch of one spends bytes on a file that opens elsewhere, if at all. Matched in
 * lower case only: `href_matches` takes no ignoreCase, so a site linking "/paper.PDF" names it in `data-no-prefetch`.
 */
export const FILE_EXTENSIONS: string[];
export namespace SPECULATION_RULES_HEADER {
    let name: "Speculation-Rules";
    let value: "\"/speculation-rules.json\"";
}
export type SpeculationOptions = {
    /**
     * More path prefixes to skip, such as "/drafts".
     */
    exclude?: string[] | undefined;
    /**
     * Skip links with a query string (searches, filters, sized images). On by default; false prefetches them.
     */
    excludeQueries?: boolean | undefined;
    /**
     * When to prefetch: moderate (pointer rests on the link, the default), conservative (on press) or eager.
     */
    eagerness?: "eager" | "conservative" | "moderate" | undefined;
    /**
     * Also prerender on press. Off by default: a prerendered page runs its scripts and analytics early.
     */
    prerender?: boolean | undefined;
};
