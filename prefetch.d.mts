/**
 * Link prefetch (prefetch.mjs): speculation rules read from a JSON file the `Speculation-Rules` header names, so no
 * script and no CSP allowance. Document rules as in Astro's prefetch (MIT, Copyright (c) 2021 Fred K. Schott).
 */

export const SPECULATION_RULES_PATH: "/speculation-rules.json";
/** Path prefixes no site prefetches: signed-in areas, APIs and anything that acts on a GET. */
export const NEVER_PREFETCH: string[];
/** File extensions no site prefetches (feeds, data, documents, archives, media), matched at the end of the path. */
export const FILE_EXTENSIONS: string[];

export interface SpeculationOptions {
  /** More path prefixes to skip, such as "/drafts". */
  exclude?: string[];
  /** Skip links with a query string (searches, filters, sized images). On by default; false prefetches them. */
  excludeQueries?: boolean;
  /** When to prefetch: moderate (pointer rests on the link, the default), conservative (on press) or eager. */
  eagerness?: "conservative" | "moderate" | "eager";
  /** Also prerender on press. Off by default: a prerendered page runs its scripts and analytics early. */
  prerender?: boolean;
}

export function speculationRules(options?: SpeculationOptions): Record<string, unknown[]>;
/** The rules as application/speculationrules+json, cached a day; with `request`, encoded as it accepts (br, else gzip). */
export function speculationRulesResponse(options?: SpeculationOptions, request?: Request): Response;
/** The header every page response carries. */
export const SPECULATION_RULES_HEADER: { readonly name: "Speculation-Rules"; readonly value: string };
