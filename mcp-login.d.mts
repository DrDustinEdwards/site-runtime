/**
 * The consent page and the upstream sign-in of a single-administrator MCP server, behind
 * @cloudflare/workers-oauth-provider, and the tightened check on a dynamic client registration (mcp-login.mjs).
 */
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { AccessEnv } from "./access-login.d.mts";

export interface LoginEnv extends AccessEnv {
  /** The server's public origin, for the /callback address; the request's origin when unset. */
  PUBLIC_ORIGIN?: string;
  OAUTH_PROVIDER: OAuthHelpers;
}

export type LoginOptions<E extends LoginEnv> = {
  /** The server's name, as the consent page and a refusal show it. */
  name: string;
  /** The read scope every grant holds, and the write scope the consent box adds. */
  scopes: { read: string; write: string };
  /** The server's own paragraphs on the consent page (trusted HTML): what it does, and what the write box allows. */
  about: string;
  /**
   * Whether the email Access verified is let in. An object admits and is added to the grant's props, for a server
   * with several people that keeps its own id for each (Carrel's personId); false or null refuses.
   */
  admit(env: E, user: { email: string; name?: string }): boolean | Record<string, unknown> | null | Promise<boolean | Record<string, unknown> | null>;
  /** Who is let in, for the consent page's line and the refusal. Default: the single configured administrator. */
  admits?: { consent: string; refusal: string };
  /** Whether the consent page's write box starts ticked for the scopes a client asked for. Default: it asked for write. */
  wantsWrite?(requested: string[]): boolean;
  /** The /health answer. Default: "ok". */
  health?(env: E): Response;
  /** The server's serverInfo name and version: when set, every callback writes a `sign-in` row to TOOL_CALL_LOG. */
  audit?: { name: string; version: string };
  /**
   * Passed to completeAuthorization. Default true: a new grant revokes the user's earlier ones for the same client. A
   * server with two connectors sharing one client id passes false, so signing into one does not sign out the other.
   */
  revokeExistingGrants?: boolean;
};

/** The consent page's one inline <style>, for the page's Content-Security-Policy hash. */
export const CONSENT_STYLE: string;
/** The provider's defaultHandler: /health, /authorize (consent page and form, urlencoded only, 64 KiB at most) and /callback. */
export function loginHandler<E extends LoginEnv>(options: LoginOptions<E>): { fetch(request: Request, env: E): Promise<Response> };
/** Whether `user.email` is ADMIN_EMAIL, compared without case. Unset admits nobody. */
export function isAdminUser(env: { ADMIN_EMAIL?: string }, user: { email?: unknown }): boolean;
/** The registration callbacks that are the same for every user: Grok's two, ChatGPT's fixed one, Gemini Enterprise's. */
export const DCR_CALLBACKS: readonly string[];
/** The https redirect URIs a registered client may name, from DCR_REDIRECT_URIS (commas or spaces). */
export function allowedRedirects(configured: string | undefined): string[];
/** Null when a registration names one to five redirect URIs, each allowlisted exactly; else why it is refused. */
export function registrationRefusal(configured: string | undefined, clientMetadata: Record<string, unknown>): string | null;
/** Counts one POST /register in KV: the 429 to send (five an hour per address, thirty a day in all), or null. */
export function registrationLimited(
  request: Request,
  kv: { get(key: string): Promise<string | null>; put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> },
  now?: number,
): Promise<Response | null>;
