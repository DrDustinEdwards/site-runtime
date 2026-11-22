/**
 * An answer of an authenticated operator surface (the owner page, the consent page): never cached, indexed or framed.
 * @param {string} body @param {number} [status] @param {string} [type] @param {Headers} [headers]
 */
export function respond(body: string, status?: number, type?: string, headers?: Headers): Response;
/**
 * The origin the server answers at: `PUBLIC_ORIGIN` when set, else the request's, no trailing slash.
 * @param {Request} request @param {{ PUBLIC_ORIGIN?: string }} env
 */
export function originOf(request: Request, env: {
    PUBLIC_ORIGIN?: string;
}): string;
/**
 * Every grant the user holds on this server, newest first: up to ten pages of the provider's list.
 * @param {OAuthHelpers} oauth
 * @param {string} userId
 * @returns {Promise<GrantSummary[]>}
 */
export function listOwnerGrants(oauth: OAuthHelpers, userId: string): Promise<GrantSummary[]>;
/**
 * Revokes one of the user's grants and logs it: the provider refuses a grant id another user holds by finding nothing
 * under this user. Answers false when the user holds no such grant.
 * @param {Partial<import("./audit-log.mjs").AuditEnv>} env
 * @param {OAuthHelpers} oauth
 * @param {{ userId: string, grantId: string, caller: string, server?: { name: string, version: string } }} input
 */
export function revokeOwnerGrant(env: Partial<import("./audit-log.mjs").AuditEnv>, oauth: OAuthHelpers, { userId, grantId, caller, server }: {
    userId: string;
    grantId: string;
    caller: string;
    server?: {
        name: string;
        version: string;
    };
}): Promise<boolean>;
/**
 * One page of the tool-call log, newest first: `limit` rows (at most 100) before the row `before`, or the newest.
 * @param {Partial<import("./audit-log.mjs").AuditEnv>} env
 * @param {{ before?: number, limit?: number }} [options]
 * @returns {Promise<AuditLogRow[]>}
 */
export function readAuditLog(env: Partial<import("./audit-log.mjs").AuditEnv>, { before, limit }?: {
    before?: number;
    limit?: number;
}): Promise<AuditLogRow[]>;
/**
 * The owner page's routes for a server's defaultHandler: GET /owner, POST /owner/revoke and /owner/sign-out, and the
 * /callback of an owner sign-in. `fetch` answers null for any other request.
 * @template {OwnerEnv} E
 * @param {{ name: string, admit(env: E, user: { email: string, name?: string }): unknown, server?: { name: string, version: string }, readsLog?(env: E, email: string): boolean | Promise<boolean> }} options
 */
export function ownerPage<E extends OwnerEnv>({ name, admit, server, readsLog }: {
    name: string;
    admit(env: E, user: {
        email: string;
        name?: string;
    }): unknown;
    server?: {
        name: string;
        version: string;
    };
    readsLog?(env: E, email: string): boolean | Promise<boolean>;
}): {
    /** Whether a /callback belongs to an owner sign-in. @param {Request} request */
    isOwnerCallback(request: Request): boolean;
    callback: (request: Request, env: E) => Promise<Response>;
    /** @param {Request} request @param {E} env @returns {Promise<Response | null>} */
    fetch(request: Request, env: E): Promise<Response | null>;
};
/** @import { OAuthHelpers } from "@cloudflare/workers-oauth-provider" */
/** @import { AccessEnv } from "./access-login.mjs" */
/** @import { AuditEnv } from "./audit-log.mjs" */
/**
 * What the owner page needs of a KV namespace.
 * @typedef {{ get(key: string): Promise<string | null>; put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>; delete(key: string): Promise<void>; }} OwnerKv
 */
/**
 *
 * - `PUBLIC_ORIGIN`: The server's public origin, for the /callback address; the request's origin when unset.
 * - `MCP_PROBE_KEY`: The list-only test key (./agent-keys `isProbeKey`); the page says whether it is set, never its value.
 * @typedef {AccessEnv & Partial<AuditEnv> & { PUBLIC_ORIGIN?: string; OAUTH_PROVIDER: OAuthHelpers; OAUTH_KV: OwnerKv; MCP_PROBE_KEY?: string; }} OwnerEnv
 */
/**
 * A tool-call log row as `readAuditLog` returns it (the table's columns, without the hash).
 * @typedef {object} AuditLogRow
 * @property {number} seq
 * @property {string} at
 * @property {string} call_id
 * @property {string} phase
 * @property {string} caller
 * @property {string} tool
 * @property {string} args JSON.
 * @property {string | null} result JSON, or null.
 * @property {string | null} server
 * @property {string | null} version
 * @property {string | null} client_id
 * @property {string | null} correlation_id
 */
/** @typedef {import("@cloudflare/workers-oauth-provider").OAuthHelpers} OAuthHelpers */
/** @typedef {import("@cloudflare/workers-oauth-provider").GrantSummary} GrantSummary */
export const OWNER_PATH: "/owner";
/**
 * The owner page's one inline <style>, rendered exactly so a Content-Security-Policy can trust it by hash
 * (./mcp-server's `withMcpHeaders` does).
 */
export const OWNER_STYLE: "\n  :root { color-scheme: light dark; }\n  body { font: 16px/1.6 system-ui, sans-serif; max-width: 72rem; margin: 2.5rem auto; padding: 0 1rem; }\n  h1 { font-size: 1.35rem; line-height: 1.3; }\n  h2 { font-size: 1.1rem; margin-top: 2rem; }\n  .scroll { overflow-x: auto; }\n  table { border-collapse: collapse; width: 100%; font-size: .9rem; }\n  th, td { text-align: left; vertical-align: top; padding: .4rem .6rem .4rem 0; border-bottom: 1px solid color-mix(in srgb, currentColor 20%, transparent); }\n  td { overflow-wrap: anywhere; }\n  small { opacity: .75; }\n  button { font: inherit; padding: .35rem .9rem; border-radius: .35rem; cursor: pointer; min-height: 24px; }\n";
/**
 * What the owner page needs of a KV namespace.
 */
export type OwnerKv = {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options?: {
        expirationTtl?: number;
    }): Promise<void>;
    delete(key: string): Promise<void>;
};
/**
 *
 * - `PUBLIC_ORIGIN`: The server's public origin, for the /callback address; the request's origin when unset.
 * - `MCP_PROBE_KEY`: The list-only test key (./agent-keys `isProbeKey`); the page says whether it is set, never its value.
 */
export type OwnerEnv = AccessEnv & Partial<AuditEnv> & {
    PUBLIC_ORIGIN?: string;
    OAUTH_PROVIDER: OAuthHelpers;
    OAUTH_KV: OwnerKv;
    MCP_PROBE_KEY?: string;
};
/**
 * A tool-call log row as `readAuditLog` returns it (the table's columns, without the hash).
 */
export type AuditLogRow = {
    seq: number;
    at: string;
    call_id: string;
    phase: string;
    caller: string;
    tool: string;
    /**
     * JSON.
     */
    args: string;
    /**
     * JSON, or null.
     */
    result: string | null;
    server: string | null;
    version: string | null;
    client_id: string | null;
    correlation_id: string | null;
};
export type OAuthHelpers = import("@cloudflare/workers-oauth-provider").OAuthHelpers;
export type GrantSummary = import("@cloudflare/workers-oauth-provider").GrantSummary;
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { AccessEnv } from "./access-login.mjs";
import type { AuditEnv } from "./audit-log.mjs";
