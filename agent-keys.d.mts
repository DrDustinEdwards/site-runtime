/** Named agent keys: one `AGENT_KEY_<NAME>` Worker secret per agent, compared in constant time (agent-keys.mjs). */

export const AGENT_KEY_PREFIX: "AGENT_KEY_";
/** The token of an `Authorization: Bearer <token>` header, or null. */
export function bearerToken(authorization: string | null | undefined): string | null;
/** The lower-cased name of the `AGENT_KEY_*` secret the header's token matched, or null (blank and misnamed secrets skipped). */
export function agentPrincipal(env: object, authorization: string | null | undefined): Promise<string | null>;
/** Read, and write when `AGENT_WRITE` (comma-separated names) lists the agent. */
export function agentScopes(env: { AGENT_WRITE?: string }, principal: string, scopes: { read: string; write: string }): string[];
/** The `{ kind: "agent", principal, scopes }` caller a key makes, or null. */
export function agentCaller(
  env: object & { AGENT_WRITE?: string },
  authorization: string | null | undefined,
  scopes: { read: string; write: string },
): Promise<{ kind: "agent"; principal: string; scopes: string[] } | null>;
