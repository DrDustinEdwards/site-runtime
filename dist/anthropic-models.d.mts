/**
 * The model table of the deprecations page (DEPRECATIONS_URL) as entries shaped like MODELS' without `cacheMin`. An
 * empty object when the page holds no such table: "could not check", never "nothing retiring".
 * @param {string} markdown
 * @returns {Record<string, Omit<ModelEntry, "cacheMin">>}
 */
export function parseDeprecations(markdown: string): Record<string, Omit<ModelEntry, "cacheMin">>;
/**
 * What is wrong with calling `ids` as of `now`, judged by `table` (from `parseDeprecations`): an id the page does not
 * list, one deprecated or retired, one retiring within 60 days, and one MODELS disagrees with. Empty when all is well.
 * @param {readonly string[]} ids
 * @param {Record<string, { state: string; retires: string | null }>} table
 * @param {Date | number} [now]
 * @returns {string[]}
 */
export function deprecationProblems(ids: readonly string[], table: Record<string, {
    state: string;
    retires: string | null;
}>, now?: Date | number): string[];
/** Whether a model can still be called: "retired", "retiring" within 60 days, "ok", or "unknown" (not in MODELS).
 * @param {string} id
 * @param {Date | number} [now]
 * @returns {{ status: "ok" | "retiring" | "retired" | "unknown"; retires: string | null }}
 */
export function modelStatus(id: string, now?: Date | number): {
    status: "ok" | "retiring" | "retired" | "unknown";
    retires: string | null;
};
/** @param {string} id */
export function modelEntry(id: string): Readonly<{
    state: "active" | "deprecated" | "retired";
    deprecated: string | null;
    retires: string | null;
    notBefore: string | null;
    cacheMin: number | null;
}> | undefined;
/** @type {Readonly<Record<string, ModelEntry>>} */
export const MODELS: Readonly<Record<string, ModelEntry>>;
/** The model each kind of call uses: a site names the role, never an id. `fast` for cheap, frequent calls, `standard` for writing a reader sees, `deep` for long reasoning. */
export const MODEL_IDS: Readonly<{
    fast: "claude-haiku-5-5";
    standard: "claude-sonnet-5-5";
    deep: "claude-opus-5-5";
}>;
/** The deprecations page as Markdown, which the daily check reads (`parseDeprecations`). */
export const DEPRECATIONS_URL: "https://platform.claude.com/docs/en/about-claude/model-deprecations.md";
export type ModelEntry = Readonly<{
    state: "active" | "deprecated" | "retired";
    deprecated: string | null;
    retires: string | null;
    notBefore: string | null;
    cacheMin: number | null;
}>;
