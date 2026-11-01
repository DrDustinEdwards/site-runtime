/** Named agent keys: one `AGENT_KEY_<NAME>` Worker secret per agent, compared in constant time (agent-keys.mjs). */

export const AGENT_KEY_PREFIX: "AGENT_KEY_";
/** The token of an `Authorization: Bearer <token>` header, or null. */
export function bearerToken(authorization: string | null | undefined): string | null;
/** The lower-cased name of the `AGENT_KEY_*` secret the header's token matched, or null (blank and misnamed secrets skipped). */
export function agentPrincipal(env: object, authorization: string | null | undefined): Promise<string | null>;
/** The agent names with a usable `AGENT_KEY_*` secret, lower-cased and sorted; never the keys. */
export function agentKeyNames(env: object): string[];
/** Read, and write when `AGENT_WRITE` (comma-separated names) lists the agent. */
export function agentScopes(env: { AGENT_WRITE?: string }, principal: string, scopes: { read: string; write: string }): string[];
/** The `{ kind: "agent", principal, scopes }` caller a key makes, or null. */
export function agentCaller(
  env: object & { AGENT_WRITE?: string },
  authorization: string | null | undefined,
  scopes: { read: string; write: string },
): Promise<{ kind: "agent"; principal: string; scopes: string[] } | null>;
/** The Worker secret holding a server's list-only test key. */
export const PROBE_KEY_SECRET: "MCP_PROBE_KEY";
/** The name the list-only test key is logged under. */
export const PROBE_PRINCIPAL: "live-check";
/** True when the header carries the `MCP_PROBE_KEY` test key (constant time; no, blank or short secret admits nothing). */
export function isProbeKey(env: object, authorization: string | null | undefined): Promise<boolean>;
/** The list-only test key's caller: no scope, listed what a read grant is, refused every call. */
export function probeCaller(): { kind: "probe"; principal: string; scopes: string[] };
