/**
 * Named agent keys (S6): the one module for an AI agent that cannot finish a server's OAuth sign-in (Grok Build could
 * not do CIMD, 2026-09-07; ruling 37). Carrel and dustinedwards-info's MCP each kept a copy of this; Capsid's minted
 * agents (a D1 row per key, by SHA-256 of the key) are a different model and stay Capsid's.
 *
 * - ONE SECRET PER AGENT. A Worker secret `AGENT_KEY_<NAME>` is the key of the agent `<name>` (lower-cased), so the name
 *   is never read from the request: it is which configured secret the presented key matched. A caller proves it holds a
 *   key and can never choose what it is called. One secret per agent, not a JSON map, so rotating one touches no other.
 * - FAILS CLOSED. No `AGENT_KEY_*` secret admits nobody; a blank secret, or one whose name is not an agent name
 *   (`[a-z0-9][a-z0-9_-]{0,31}`), is skipped, so an empty secret cannot become a master key; a malformed header is null.
 *   Null always means "not an agent, go on to OAuth", never a refusal on its own.
 * - CONSTANT TIME. Every candidate is compared through ./compare's `safeEqual`, with no early exit, so the time taken
 *   does not say which key matched or where it sat.
 * - LEAST SCOPE. An agent holds the read scope; the write scope only when `AGENT_WRITE` (names separated by commas)
 *   lists it. What an agent may then do is the server's (./mcp-server `authorizeCall`, Carrel's people table).
 */

import { safeEqual } from "./compare.mjs";

export const AGENT_KEY_PREFIX = "AGENT_KEY_";
const AGENT_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/**
 * The token of an `Authorization: Bearer <token>` header, or null.
 * @param {string | null | undefined} authorization
 */
export function bearerToken(authorization) {
  return /^Bearer[ ]+(\S+)$/i.exec(String(authorization ?? "").trim())?.[1] ?? null;
}

/**
 * Which agent presented this Authorization header: the lower-cased name of the `AGENT_KEY_*` secret its token matched,
 * or null.
 * @param {Record<string, unknown>} env
 * @param {string | null | undefined} authorization
 * @returns {Promise<string | null>}
 */
export async function agentPrincipal(env, authorization) {
  const presented = bearerToken(authorization);
  if (!presented) return null;
  /** @type {string | null} */
  let found = null;
  for (const [secret, value] of Object.entries(env)) {
    if (!secret.startsWith(AGENT_KEY_PREFIX)) continue;
    const name = secret.slice(AGENT_KEY_PREFIX.length).toLowerCase();
    if (!AGENT_NAME.test(name) || typeof value !== "string" || !value.trim()) continue;
    if (await safeEqual(presented, value.trim())) found = name;
  }
  return found;
}

/**
 * The agent names the Worker holds a usable key for, sorted: what an owner page lists. Never the keys.
 * @param {Record<string, unknown>} env
 * @returns {string[]}
 */
export function agentKeyNames(env) {
  return Object.entries(env)
    .filter(([secret, value]) => secret.startsWith(AGENT_KEY_PREFIX) && typeof value === "string" && value.trim())
    .map(([secret]) => secret.slice(AGENT_KEY_PREFIX.length).toLowerCase())
    .filter((name) => AGENT_NAME.test(name))
    .sort();
}

/**
 * The scopes an agent holds: read, and write when `AGENT_WRITE` names it.
 * @param {{ AGENT_WRITE?: string }} env
 * @param {string} principal
 * @param {{ read: string, write: string }} scopes ./mcp-server's `mcpScopes(prefix)`
 * @returns {string[]}
 */
export function agentScopes(env, principal, scopes) {
  const writers = String(env.AGENT_WRITE ?? "").split(",").map((name) => name.trim().toLowerCase());
  return writers.includes(principal) ? [scopes.read, scopes.write] : [scopes.read];
}

/**
 * The MCP caller (./mcp-server `McpCaller`) an agent key makes, or null when the header holds none.
 * @param {Record<string, unknown> & { AGENT_WRITE?: string }} env
 * @param {string | null | undefined} authorization
 * @param {{ read: string, write: string }} scopes
 * @returns {Promise<{ kind: "agent", principal: string, scopes: string[] } | null>}
 */
export async function agentCaller(env, authorization, scopes) {
  const principal = await agentPrincipal(env, authorization);
  return principal ? { kind: "agent", principal, scopes: agentScopes(env, principal, scopes) } : null;
}
