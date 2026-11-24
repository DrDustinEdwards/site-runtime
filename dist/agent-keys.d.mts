/**
 * The token of an `Authorization: Bearer <token>` header, or null.
 * @param {string | null | undefined} authorization
 */
export function bearerToken(authorization: string | null | undefined): string | null;
/**
 * Which agent presented this Authorization header: the lower-cased name of the `AGENT_KEY_*` secret its token matched,
 * or null.
 * @param {object} env
 * @param {string | null | undefined} authorization
 * @returns {Promise<string | null>}
 */
export function agentPrincipal(env: object, authorization: string | null | undefined): Promise<string | null>;
/**
 * The agent names the Worker holds a usable key for, sorted: what an owner page lists. Never the keys.
 * @param {object} env
 * @returns {string[]}
 */
export function agentKeyNames(env: object): string[];
/**
 * The scopes an agent holds: read, and write when `AGENT_WRITE` names it.
 * @param {{ AGENT_WRITE?: string }} env
 * @param {string} principal
 * @param {{ read: string, write: string }} scopes ./mcp-server's `mcpScopes(prefix)`
 * @returns {string[]}
 */
export function agentScopes(env: {
    AGENT_WRITE?: string;
}, principal: string, scopes: {
    read: string;
    write: string;
}): string[];
/**
 * The MCP caller (./mcp-server `McpCaller`) an agent key makes, or null when the header holds none.
 * @param {Record<string, unknown> & { AGENT_WRITE?: string }} env
 * @param {string | null | undefined} authorization
 * @param {{ read: string, write: string }} scopes
 * @returns {Promise<{ kind: "agent", principal: string, scopes: string[] } | null>}
 */
export function agentCaller(env: Record<string, unknown> & {
    AGENT_WRITE?: string;
}, authorization: string | null | undefined, scopes: {
    read: string;
    write: string;
}): Promise<{
    kind: "agent";
    principal: string;
    scopes: string[];
} | null>;
/**
 * True when the header carries the server's list-only test key. Fails closed: no `MCP_PROBE_KEY`, a blank one or one
 * under KEY_MIN characters admits nothing, and the comparison is constant time.
 * @param {object} env
 * @param {string | null | undefined} authorization
 * @returns {Promise<boolean>}
 */
export function isProbeKey(env: object, authorization: string | null | undefined): Promise<boolean>;
/**
 * The caller the list-only test key makes: no scope, so every scope check refuses it, and ./mcp-server's
 * `registerTools` lists it what a read grant is listed.
 * @returns {{ kind: "probe", principal: string, scopes: string[] }}
 */
export function probeCaller(): {
    kind: "probe";
    principal: string;
    scopes: string[];
};
export const AGENT_KEY_PREFIX: "AGENT_KEY_";
/** The Worker secret holding a server's list-only test key. */
export const PROBE_KEY_SECRET: "MCP_PROBE_KEY";
/** The name the list-only test key is logged under. */
export const PROBE_PRINCIPAL: "live-check";
