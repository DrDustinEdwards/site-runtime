/**
 * Where a client's redirect URI sends the access: its host (the scheme for a private-use one such as `cursor://`),
 * and whether that is an app on this computer (RFC 8252 7.1, 7.3), with the warning to show. Never throws: an
 * unparsable URI comes back as itself, not local.
 * @param {string} uri
 * @returns {{ host: string, local: boolean, warning: string | null }}
 */
export function describeRedirect(uri: string): {
    host: string;
    local: boolean;
    warning: string | null;
};
/**
 * The provider's defaultHandler: /health, the consent page and form on /authorize, the Access /callback, and /owner
 * unless `owner` is false. A missing Access setting answers 503 on every sign-in route.
 * @template {LoginEnv} E
 * @param {LoginOptions<E>} options
 */
export function loginHandler<E extends LoginEnv>({ name, scopes, about, admit, admits, wantsWrite, health, audit, revokeExistingGrants, owner, }: LoginOptions<E>): {
    /** @param {Request} request @param {E} env @returns {Promise<Response>} */
    fetch(request: Request, env: E): Promise<Response>;
};
/**
 * Whether a signed-in email is an administrator's: `ADMIN_EMAIL` or an entry of `CO_OWNER_EMAILS`, compared without
 * case (`isAdminEmail`, ./access). The email is the one Cloudflare Access verified. Fails closed: an unset or blank
 * `ADMIN_EMAIL` admits nobody.
 * @param {{ ADMIN_EMAIL?: string, CO_OWNER_EMAILS?: string }} env
 * @param {{ email?: unknown }} user
 */
export function isAdminUser(env: {
    ADMIN_EMAIL?: string;
    CO_OWNER_EMAILS?: string;
}, user: {
    email?: unknown;
}): boolean;
/**
 * The consent page's one inline <style>, trusted by hash (`scriptHash(CONSENT_STYLE)` from `./csp`). A minimal
 * copy of Capsomer's consent screen, which site-runtime cannot depend on, as OWNER_STYLE is for the owner page.
 */
export const CONSENT_STYLE: "\n  :root { color-scheme: light dark; --consent-muted: color-mix(in srgb, CanvasText 62%, Canvas); --consent-line: color-mix(in srgb, CanvasText 16%, Canvas); }\n  body { margin: 0; font: 16px/1.6 system-ui, sans-serif; background: color-mix(in srgb, CanvasText 3%, Canvas); color: CanvasText; }\n  .cap-consent { box-sizing: border-box; display: grid; align-content: center; min-height: 100vh; width: 100%; max-width: calc(460px + 48px); margin: 0 auto; padding: 24px; }\n  .cap-consent:focus { outline: none; }\n  .cap-panel { background: Canvas; border: 1px solid var(--consent-line); border-radius: 10px; }\n  .cap-consent-body { display: grid; gap: 16px; padding: 48px 24px; }\n  .cap-consent-title { margin: 0; font-size: 1.125rem; font-weight: 500; line-height: 1.3; }\n  .cap-consent-text, .cap-consent-body > p { margin: 0; color: var(--consent-muted); font-size: .8125rem; }\n  .cap-consent-text strong { color: CanvasText; font-weight: 500; }\n  .cap-alert { padding: 8px 12px; border: 1px solid; border-radius: 6px; font-size: .8125rem; }\n  .cap-consent-form { display: grid; gap: 20px; }\n  .cap-consent-box { padding: 12px 16px; border: 1px solid var(--consent-line); border-radius: 10px; }\n  .cap-check { display: inline-flex; align-items: flex-start; gap: 12px; min-height: 24px; cursor: pointer; }\n  .cap-check input { margin: .3em 0 0; }\n  .cap-consent-line { display: block; margin-top: 2px; color: var(--consent-muted); font-size: .8125rem; }\n  .cap-consent-mono { font-family: ui-monospace, monospace; font-size: .75rem; }\n  .cap-consent-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }\n  .cap-btn { font: inherit; font-size: .9375rem; min-height: 40px; padding: 0 16px; border: 1px solid var(--consent-line); border-radius: 6px; background: Canvas; color: CanvasText; cursor: pointer; }\n  .cap-btn[data-variant=\"primary\"] { background: CanvasText; border-color: CanvasText; color: Canvas; }\n  .cap-btn:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }\n";
/**
 *
 * - `PUBLIC_ORIGIN`: The server's public origin, for the /callback address; the request's origin when unset.
 * - `DEPLOY_SHA`: The deployed commit, for the default /health's `sha`.
 * - `OAUTH_KV`: The provider's KV namespace; the owner page keeps its sign-ins and sessions there.
 */
export type LoginEnv = AccessEnv & {
    PUBLIC_ORIGIN?: string;
    DEPLOY_SHA?: string;
    OAUTH_PROVIDER: OAuthHelpers;
    OAUTH_KV: import("./owner-page.mjs").OwnerKv;
};
export type LoginOptions<E extends LoginEnv> = {
    name: string;
    scopes: {
        read: string;
        write: string;
    };
    about: string;
    admit(env: E, user: {
        email: string;
        name?: string;
    }): boolean | Record<string, unknown> | null | Promise<boolean | Record<string, unknown> | null>;
    admits?: {
        refusal: string;
    };
    wantsWrite?(requested: string[]): boolean;
    health?(env: E): Response | Promise<Response>;
    audit?: {
        name: string;
        version: string;
    };
    revokeExistingGrants?: boolean;
    owner?: boolean | {
        readsLog(env: E, email: string): boolean | Promise<boolean>;
    };
};
export type AuthRequest = import("@cloudflare/workers-oauth-provider").AuthRequest;
export type ClientInfo = import("@cloudflare/workers-oauth-provider").ClientInfo;
import type { AccessEnv } from "./access-login.mjs";
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
export { DCR_CALLBACKS, allowedRedirects, registrationLimited, registrationRefusal } from "./mcp-registration.mjs";
