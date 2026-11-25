/**
 * What is wrong with a `tools/list` result's tools: T1 a bad or repeated name, no title or description; T2 an annotation
 * hint not set as a boolean; T3 no `outputSchema` of type object; T4 an `inputSchema` that is not an object, a `$schema`
 * other than 2020-12, an object without `additionalProperties: false`, a non-local `$ref`, and (a warning) a string with
 * no `pattern`, `enum`, `const` or `format`; T9 no icon, or one whose `src` is neither https nor a `data:image/`.
 * @param {ReadonlyArray<object>} tools
 * @returns {ToolListProblem[]}
 */
export function toolListProblems(tools: ReadonlyArray<object>): ToolListProblem[];
/**
 * The SHA-256 of a tool list (T12, the tool-poisoning guard): every tool as `tools/list` sends it, `_meta` left out,
 * sorted by name, as canonical JSON. Pin it in the server's tests so any change to a name, description, schema or
 * annotation fails CI until reviewed; give the daily check the same pin (`--tools-hash`).
 * @param {ReadonlyArray<Record<string, unknown>>} tools
 * @returns {Promise<string>}
 */
export function toolListHash(tools: ReadonlyArray<Record<string, unknown>>): Promise<string>;
/**
 * The `cacheHints` option: every cacheable result lives `ttlMs`, private unless named in `shared` (the same for every
 * caller). Private is the default because a list filtered by the grant served from a shared cache is one person's list
 * shown to another.
 * @param {{ ttlMs?: number, shared?: ReadonlyArray<typeof CACHEABLE[number]> }} [options]
 * @returns {Record<CacheableMethod, { ttlMs: number; cacheScope: "public" | "private" }>}
 */
export function mcpCacheHints({ ttlMs, shared }?: {
    ttlMs?: number;
    shared?: ReadonlyArray<(typeof CACHEABLE)[number]>;
}): Record<CacheableMethod, {
    ttlMs: number;
    cacheScope: "public" | "private";
}>;
export type ToolListProblem = {
    item: "T1" | "T2" | "T3" | "T4" | "T9";
    tool: string;
    severity: "error" | "warning";
    detail: string;
};
export type CacheableMethod = "tools/list" | "prompts/list" | "resources/list" | "resources/templates/list" | "resources/read" | "server/discover";
declare const CACHEABLE: readonly ["tools/list", "prompts/list", "resources/list", "resources/templates/list", "resources/read", "server/discover"];
export {};
