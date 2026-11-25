/**
 * The tool list's rules (T1-T4, T9) and its pin (T12), and the cache hints a list goes out with. ./mcp-server re-exports
 * what a caller imports.
 */

import { canonicalJson, sha256Hex } from "./encoding.mjs";

/** @import { ToolListProblem } from "./mcp-server.mjs" */
/** @import { CacheableMethod } from "./mcp-server.mjs" */

// Over `tools/list` as a client receives it, shared by a server's own test and the daily live check (bin/ai-audit.mjs).
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;
const HINTS = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"];
const DIALECT = "https://json-schema.org/draft/2020-12/schema";

/**
 * What is wrong with a `tools/list` result's tools: T1 a bad or repeated name, no title or description; T2 an annotation
 * hint not set as a boolean; T3 no `outputSchema` of type object; T4 an `inputSchema` that is not an object, a `$schema`
 * other than 2020-12, an object without `additionalProperties: false`, a non-local `$ref`, and (a warning) a string with
 * no `pattern`, `enum`, `const` or `format`; T9 no icon, or one whose `src` is neither https nor a `data:image/`.
 * @param {ReadonlyArray<object>} tools
 * @returns {ToolListProblem[]}
 */
export function toolListProblems(tools) {
  /** @type {ToolListProblem[]} */
  const out = [];
  const seen = new Set();
  for (const listed of tools) {
    const tool = /** @type {Record<string, any>} */ (listed);
    const name = String(tool?.name ?? "");
    const add = (
      /** @type {ToolListProblem["item"]} */ item,
      /** @type {string} */ detail,
      severity = /** @type {"error" | "warning"} */ ("error"),
    ) => out.push({ item, tool: name, severity, detail });
    if (!TOOL_NAME.test(name))
      add("T1", `the name ${JSON.stringify(name)} is not [A-Za-z0-9_.-]{1,128}`);
    if (seen.has(name)) add("T1", "the name is listed twice");
    seen.add(name);
    if (!String(tool.title ?? tool.annotations?.title ?? "").trim()) add("T1", "has no title");
    if (!String(tool.description ?? "").trim()) add("T1", "has no description");
    const unset = HINTS.filter((hint) => typeof tool.annotations?.[hint] !== "boolean");
    if (unset.length) add("T2", `does not set ${unset.join(", ")}`);
    if (tool.outputSchema?.type !== "object") add("T3", "has no outputSchema of type object");
    const input = tool.inputSchema;
    if (input?.type !== "object") add("T4", "its inputSchema is not of type object");
    else {
      if (input.$schema !== undefined && input.$schema !== DIALECT)
        add("T4", `its inputSchema declares ${input.$schema}, not JSON Schema 2020-12`);
      schemaProblems(input, "inputSchema", add);
    }
    const icons = Array.isArray(tool.icons) ? tool.icons : [];
    if (icons.length === 0) add("T9", "has no icon");
    for (const icon of icons)
      if (!/^(?:https:\/\/|data:image\/)/.test(String(icon?.src ?? "")))
        add(
          "T9",
          `its icon ${JSON.stringify(String(icon?.src ?? "")).slice(0, 80)} is neither https nor a data:image URI`,
        );
  }
  return out;
}

/**
 * T4 at every depth of a schema.
 * @param {any} schema
 * @param {string} at
 * @param {(item: ToolListProblem["item"], detail: string, severity?: "error" | "warning") => void} add
 */
function schemaProblems(schema, at, add) {
  if (!schema || typeof schema !== "object") return;
  if (typeof schema.$ref === "string" && !schema.$ref.startsWith("#"))
    add("T4", `${at} has a $ref that is not local: ${schema.$ref.slice(0, 80)}`);
  const types = [schema.type].flat();
  if ((types.includes("object") || schema.properties) && schema.additionalProperties !== false)
    add("T4", `${at} does not set additionalProperties: false`);
  if (
    types.includes("string") &&
    schema.pattern === undefined &&
    schema.enum === undefined &&
    schema.const === undefined &&
    schema.format === undefined
  ) {
    add("T4", `${at} is a string with no pattern, enum, const or format`, "warning");
  }
  for (const [key, child] of Object.entries(schema.properties ?? {}))
    schemaProblems(child, `${at}.${key}`, add);
  for (const key of ["items", "additionalItems", "not"])
    if (schema[key] && typeof schema[key] === "object") schemaProblems(schema[key], `${at}[]`, add);
  for (const key of ["anyOf", "oneOf", "allOf", "prefixItems"])
    for (const [i, child] of (Array.isArray(schema[key]) ? schema[key] : []).entries())
      schemaProblems(child, `${at}.${key}[${i}]`, add);
  for (const key of ["$defs", "definitions"])
    for (const [name, child] of Object.entries(schema[key] ?? {}))
      schemaProblems(child, `${at}.${key}.${name}`, add);
}

/**
 * The SHA-256 of a tool list (T12, the tool-poisoning guard): every tool as `tools/list` sends it, `_meta` left out,
 * sorted by name, as canonical JSON. Pin it in the server's tests so any change to a name, description, schema or
 * annotation fails CI until reviewed; give the daily check the same pin (`--tools-hash`).
 * @param {ReadonlyArray<Record<string, unknown>>} tools
 * @returns {Promise<string>}
 */
export async function toolListHash(tools) {
  const plain = tools
    .map(({ _meta, ...tool }) => tool)
    .sort((a, b) =>
      String(a.name) < String(b.name) ? -1 : String(a.name) > String(b.name) ? 1 : 0,
    );
  return sha256Hex(canonicalJson(plain));
}

// LIST CACHE HINTS (MCP 2026-07-28): the SDK's `cacheHints` option; without it results go out as `ttlMs: 0`, private.

const CACHEABLE = /** @type {const} */ ([
  "tools/list",
  "prompts/list",
  "resources/list",
  "resources/templates/list",
  "resources/read",
  "server/discover",
]);

/**
 * The `cacheHints` option: every cacheable result lives `ttlMs`, private unless named in `shared` (the same for every
 * caller). Private is the default because a list filtered by the grant served from a shared cache is one person's list
 * shown to another.
 * @param {{ ttlMs?: number, shared?: ReadonlyArray<typeof CACHEABLE[number]> }} [options]
 * @returns {Record<CacheableMethod, { ttlMs: number; cacheScope: "public" | "private" }>}
 */
export function mcpCacheHints({ ttlMs = 60_000, shared = [] } = {}) {
  return /** @type {Record<CacheableMethod, { ttlMs: number; cacheScope: "public" | "private" }>} */ (
    Object.fromEntries(
      CACHEABLE.map((method) => [
        method,
        { ttlMs, cacheScope: shared.includes(method) ? "public" : "private" },
      ]),
    )
  );
}
