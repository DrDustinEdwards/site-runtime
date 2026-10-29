/**
 * Link prefetch: the next page starts loading while the reader's pointer rests on its link, as Astro's `prefetch`
 * does, without a script. Chrome and Edge read speculation rules from a JSON file the `Speculation-Rules` response
 * header names; a browser without them ignores the header and loads links as before.
 *
 * Why the header and not an inline `<script type="speculationrules">`: an inline rule set needs its own CSP allowance
 * ('inline-speculation-rules' or a hash) on every page, and the header needs none, since the file comes from the site
 * itself. The rules are document rules matched by selector, the deterministic form Astro switched to for CSP
 * (packages/astro/src/prefetch/speculation-rules.ts, MIT, Copyright (c) 2021 Fred K. Schott).
 *
 * Prefetch only by default: a prerendered page runs its scripts and analytics before the reader arrives, so
 * `prerender` is opt-in per site, at `conservative` (on press), where the reader has as good as clicked.
 */

/** The path every site serves its rules at. */
export const SPECULATION_RULES_PATH = "/speculation-rules.json";

/** The paths no site prefetches: its signed-in areas, its APIs and anything that acts on a GET. */
export const NEVER_PREFETCH = ["/admin", "/api", "/auth", "/logout", "/sign-out", "/cdn-cgi"];

const EAGERNESS = new Set(["conservative", "moderate", "eager"]);

/**
 * The rule set: same-origin links, minus `exclude` (path prefixes, added to `NEVER_PREFETCH`), downloads, links that
 * open elsewhere, `rel=nofollow` and anything marked `data-no-prefetch`.
 * @param {{ exclude?: string[], eagerness?: "conservative" | "moderate" | "eager", prerender?: boolean }} [options]
 */
export function speculationRules({ exclude = [], eagerness = "moderate", prerender = false } = {}) {
  if (!EAGERNESS.has(eagerness)) throw new Error(`speculationRules: eagerness "${eagerness}" is not conservative, moderate or eager.`);
  for (const path of exclude) {
    if (!/^\/[^*?#]*$/.test(path)) throw new Error(`speculationRules: exclude "${path}" is not a path prefix such as /drafts.`);
  }
  const prefixes = [...new Set([...NEVER_PREFETCH, ...exclude])];
  const where = {
    and: [
      { href_matches: "/*" },
      ...prefixes.flatMap((p) => [{ not: { href_matches: p } }, { not: { href_matches: `${p.replace(/\/$/, "")}/*` } }]),
      { not: { selector_matches: "[download], [target]:not([target=_self]), [rel~=nofollow], [data-no-prefetch], [data-no-prefetch] a" } },
    ],
  };
  /** @type {Record<string, unknown[]>} */
  const rules = { prefetch: [{ source: "document", where, eagerness }] };
  if (prerender) rules.prerender = [{ source: "document", where, eagerness: "conservative" }];
  return rules;
}

/**
 * The response for `SPECULATION_RULES_PATH`: the rules, typed as browsers require, cached a day.
 * @param {Parameters<typeof speculationRules>[0]} [options]
 */
export function speculationRulesResponse(options) {
  return new Response(JSON.stringify(speculationRules(options)), {
    headers: {
      "content-type": "application/speculationrules+json",
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff",
    },
  });
}

/** The header a page response carries so the browser reads the rules. */
export const SPECULATION_RULES_HEADER = /** @type {const} */ ({ name: "Speculation-Rules", value: `"${SPECULATION_RULES_PATH}"` });
