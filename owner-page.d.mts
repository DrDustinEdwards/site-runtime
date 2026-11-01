/** The owner page of an MCP server: the admitted person's grants with Revoke, the agent keys, the tool-call log (owner-page.mjs). */
import type { GrantSummary, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { AccessEnv } from "./access-login.d.mts";
import type { AuditEnv } from "./audit-log.d.mts";

/** What the owner page needs of a KV namespace. */
export interface OwnerKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface OwnerEnv extends AccessEnv, Partial<AuditEnv> {
  /** The server's public origin, for the /callback address; the request's origin when unset. */
  PUBLIC_ORIGIN?: string;
  OAUTH_PROVIDER: OAuthHelpers;
  OAUTH_KV: OwnerKv;
  /** The list-only test key (./agent-keys `isProbeKey`); the page says whether it is set, never its value. */
  MCP_PROBE_KEY?: string;
}

/** A tool-call log row as `readAuditLog` returns it (the table's columns, without the hash). */
export interface AuditLogRow {
  seq: number;
  at: string;
  call_id: string;
  phase: string;
  caller: string;
  tool: string;
  /** JSON. */
  args: string;
  /** JSON, or null. */
  result: string | null;
  server: string | null;
  version: string | null;
  client_id: string | null;
  correlation_id: string | null;
}

/** The page's path: /owner. */
export const OWNER_PATH: string;
/** The page's one inline <style>, for a Content-Security-Policy hash. */
export const OWNER_STYLE: string;

/** Every grant the user holds, newest first (up to ten pages of 100). */
export function listOwnerGrants(oauth: OAuthHelpers, userId: string): Promise<GrantSummary[]>;
/** Revokes one of the user's grants and writes a `revoked` row when TOOL_CALL_LOG is bound; false when the user holds no such grant. */
export function revokeOwnerGrant(
  env: Partial<AuditEnv>,
  oauth: OAuthHelpers,
  input: { userId: string; grantId: string; caller: string; server?: { name: string; version: string } },
): Promise<boolean>;
/** One page of the tool-call log, newest first: `limit` rows (default 50, at most 100) before the row `before`. */
export function readAuditLog(env: Partial<AuditEnv>, options?: { before?: number; limit?: number }): Promise<AuditLogRow[]>;

/** The owner page's routes; `loginHandler` mounts them on every server it fronts. */
export function ownerPage<E extends OwnerEnv>(options: {
  /** The server's name, as the page shows it. */
  name: string;
  /** Who may open the page: the same check as consent. */
  admit(env: E, user: { email: string; name?: string }): unknown;
  /** The server's serverInfo name and version, for the log rows the page writes. */
  server?: { name: string; version: string };
  /** Whether this person reads the whole tool-call log; default everyone admitted (a single-administrator server). */
  readsLog?(env: E, email: string): boolean | Promise<boolean>;
}): {
  /** Whether a /callback is an owner sign-in's (its state starts `owner.`). */
  isOwnerCallback(request: Request): boolean;
  callback(request: Request, env: E): Promise<Response>;
  /** GET /owner, POST /owner/revoke and /owner/sign-out; null for any other path. */
  fetch(request: Request, env: E): Promise<Response | null>;
};
