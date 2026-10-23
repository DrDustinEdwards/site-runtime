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
  /** Whether the email Access verified is let in. */
  admit(env: E, user: { email: string; name?: string }): boolean | Promise<boolean>;
};

/** The consent page's one inline <style>, for the page's Content-Security-Policy hash. */
export const CONSENT_STYLE: string;
/** The provider's defaultHandler: /health, /authorize (consent page and form) and /callback. */
export function loginHandler<E extends LoginEnv>(options: LoginOptions<E>): { fetch(request: Request, env: E): Promise<Response> };
/** Whether `user.email` is ADMIN_EMAIL, compared without case. Unset admits nobody. */
export function isAdminUser(env: { ADMIN_EMAIL?: string }, user: { email?: unknown }): boolean;
/** The redirect URIs a registered client may name, from the comma-separated DCR_REDIRECT_URIS. */
export function allowedRedirects(configured: string | undefined): string[];
/** Null when a registration names only allowlisted redirect URIs, exactly; else why it is refused. */
export function registrationRefusal(configured: string | undefined, clientMetadata: Record<string, unknown>): string | null;
