/**
 * Link prefetch (prefetch.mjs): speculation rules read from a JSON file the `Speculation-Rules` header names, so no
 * script and no CSP allowance. Document rules as in Astro's prefetch (MIT, Copyright (c) 2021 Fred K. Schott).
 */

export const SPECULATION_RULES_PATH: "/speculation-rules.json";
/** Path prefixes no site prefetches: signed-in areas, APIs and anything that acts on a GET. */
export const NEVER_PREFETCH: string[];

export interface SpeculationOptions {
  /** More path prefixes to skip, such as "/drafts". */
  exclude?: string[];
  /** When to prefetch: moderate (pointer rests on the link, the default), conservative (on press) or eager. */
  eagerness?: "conservative" | "moderate" | "eager";
  /** Also prerender on press. Off by default: a prerendered page runs its scripts and analytics early. */
  prerender?: boolean;
}

export function speculationRules(options?: SpeculationOptions): Record<string, unknown[]>;
/** The rules as application/speculationrules+json, cached a day. */
export function speculationRulesResponse(options?: SpeculationOptions): Response;
/** The header every page response carries. */
export const SPECULATION_RULES_HEADER: { readonly name: "Speculation-Rules"; readonly value: string };
