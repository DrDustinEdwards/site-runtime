/**
 * The consent page and the upstream sign-in of a single-administrator MCP server, behind
 * @cloudflare/workers-oauth-provider, and the tightened check on a dynamic client registration.
 *
 * After consent the handler sends the person to Cloudflare Access for SaaS (`./access-login`) and lets in only
 * the email the caller's `admit` accepts. The consent handle and upstream state are the provider's own helpers,
 * each bound to the browser by a cookie and single-use; the PKCE verifier and nonce stay server-side.
 *
 * Least scope first: the write box starts ticked only when the client asked for write, the grant is what the
 * administrator ticked, and every grant holds the read scope. A server passing `audit` gets a `sign-in` row
 * for every callback. The provider is matched by its errors' names, not imported, so this package keeps no
 * dependencies.
 */

import { isAdminEmail } from "./access.mjs";
import { accessSaas, authorizationUrl, finishSignIn, newSignIn } from "./access-login.mjs";
import { correlationId, recordAudit } from "./audit-log.mjs";
import { readCapped } from "./body.mjs";
import { healthResponse } from "./health.mjs";
import { redirectResponse } from "./http.mjs";
import { deployedSha } from "./deploy.mjs";
import { PRIVATE_PAGE_HEADERS, compressUntransformed } from "./edge-cache.mjs";
import { escapeHtml as escape } from "./html.mjs";
import { originOf, ownerPage, respond } from "./owner-page.mjs";

/** @import { OAuthHelpers } from "@cloudflare/workers-oauth-provider" */
/** @import { AccessEnv } from "./access-login.mjs" */

/**
 *
 * - `PUBLIC_ORIGIN`: The server's public origin, for the /callback address; the request's origin when unset.
 * - `DEPLOY_SHA`: The deployed commit, for the default /health's `sha`.
 * - `OAUTH_KV`: The provider's KV namespace; the owner page keeps its sign-ins and sessions there.
 * @typedef {AccessEnv & { PUBLIC_ORIGIN?: string; DEPLOY_SHA?: string; OAUTH_PROVIDER: OAuthHelpers; OAUTH_KV: import("./owner-page.mjs").OwnerKv; }} LoginEnv
 */

/**
 * @template {LoginEnv} E
 *
 * - `name`: The server's name, as the consent page and a refusal show it.
 * - `scopes`: The read scope every grant holds, and the write scope the consent box adds.
 * - `about`: The server's own paragraphs on the consent page (trusted HTML).
 * - `admit`: Whether the email Access verified is let in. An object admits and is added to the grant's props (Carrel's personId); false or null refuses.
 * - `admits`: Who is let in, for the consent page's line and the refusal. Default: the single configured administrator.
 * - `wantsWrite`: Whether the consent page's write box starts ticked for the scopes a client asked for. Default: it asked for write.
 * - `health`: The /health answer. Default: healthResponse({ sha: env.DEPLOY_SHA }).
 * - `audit`: The server's serverInfo name and version: when set, every callback writes a `sign-in` row to TOOL_CALL_LOG.
 * - `revokeExistingGrants`: Passed to completeAuthorization. Default true: a new grant revokes the user's earlier ones for the same client. False keeps earlier grants, for two connectors sharing one client id.
 * - `owner`: Default true: /owner serves the owner page (./owner-page; needs OAUTH_KV). A server with several people passes `{ readsLog(env, email) }`, so only its owner reads everyone's calls; false turns the page off.
 * @typedef {{ name: string; scopes: { read: string; write: string }; about: string; admit( env: E, user: { email: string; name?: string }, ): boolean | Record<string, unknown> | null | Promise<boolean | Record<string, unknown> | null>; admits?: { refusal: string }; wantsWrite?(requested: string[]): boolean; health?(env: E): Response | Promise<Response>; audit?: { name: string; version: string }; revokeExistingGrants?: boolean; owner?: boolean | { readsLog(env: E, email: string): boolean | Promise<boolean> }; }} LoginOptions
 */

/** @typedef {import("@cloudflare/workers-oauth-provider").AuthRequest} AuthRequest */
/** @typedef {import("@cloudflare/workers-oauth-provider").ClientInfo} ClientInfo */

const LOCAL_REDIRECT_WARNING = [
  "This sends access to an app on your computer.",
  "Continue only if you just started signing in from it.",
];

/**
 * Where a client's redirect URI sends the access: its host (the scheme for a private-use one such as `cursor://`),
 * and whether that is an app on this computer (RFC 8252 7.1, 7.3), with the warning to show. Never throws: an
 * unparsable URI comes back as itself, not local.
 * @param {string} uri
 * @returns {{ host: string, local: boolean, warning: string | null }}
 */
export function describeRedirect(uri) {
  let url;
  try {
    url = new URL(uri);
  } catch {
    return { host: uri, local: false, warning: null };
  }
  const web = url.protocol === "https:" || url.protocol === "http:";
  const host = web ? url.hostname : `${url.protocol}//`;
  const local = web ? /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/.test(url.hostname) : true;
  return { host, local, warning: local ? LOCAL_REDIRECT_WARNING.join(" ") : null };
}

/**
 * The OAuth error answer, once the redirect URI is known good.
 * @param {AuthRequest} request @param {string} description @param {Headers} [headers]
 */
function redirectError(request, description, headers) {
  const url = new URL(request.redirectUri);
  url.searchParams.set("error", "access_denied");
  url.searchParams.set("error_description", description);
  url.searchParams.set("state", request.state);
  if (request.issuer) url.searchParams.set("iss", request.issuer);
  return redirectResponse(url.href, 302, headers);
}

/** @param {ClientInfo | null} client @param {string} clientId */
function clientLabel(client, clientId) {
  const name = client?.clientName?.trim();
  if (name) return name.slice(0, 100);
  try {
    return new URL(clientId).hostname;
  } catch {
    return "an unnamed client";
  }
}

/**
 * The consent page's one inline <style>, trusted by hash (`scriptHash(CONSENT_STYLE)` from `./csp`). A minimal
 * copy of Capsomer's consent screen, which site-runtime cannot depend on, as OWNER_STYLE is for the owner page.
 */
export const CONSENT_STYLE = `
  :root { color-scheme: light dark; --consent-muted: color-mix(in srgb, CanvasText 62%, Canvas); --consent-line: color-mix(in srgb, CanvasText 16%, Canvas); }
  body { margin: 0; font: 16px/1.6 system-ui, sans-serif; background: color-mix(in srgb, CanvasText 3%, Canvas); color: CanvasText; }
  .cap-consent { box-sizing: border-box; display: grid; align-content: center; min-height: 100vh; width: 100%; max-width: calc(460px + 48px); margin: 0 auto; padding: 24px; }
  .cap-consent:focus { outline: none; }
  .cap-panel { background: Canvas; border: 1px solid var(--consent-line); border-radius: 10px; }
  .cap-consent-body { display: grid; gap: 16px; padding: 48px 24px; }
  .cap-consent-title { margin: 0; font-size: 1.125rem; font-weight: 500; line-height: 1.3; }
  .cap-consent-text, .cap-consent-body > p { margin: 0; color: var(--consent-muted); font-size: .8125rem; }
  .cap-consent-text strong { color: CanvasText; font-weight: 500; }
  .cap-alert { padding: 8px 12px; border: 1px solid; border-radius: 6px; font-size: .8125rem; }
  .cap-consent-form { display: grid; gap: 20px; }
  .cap-consent-box { padding: 12px 16px; border: 1px solid var(--consent-line); border-radius: 10px; }
  .cap-check { display: inline-flex; align-items: flex-start; gap: 12px; min-height: 24px; cursor: pointer; }
  .cap-check input { margin: .3em 0 0; }
  .cap-consent-line { display: block; margin-top: 2px; color: var(--consent-muted); font-size: .8125rem; }
  .cap-consent-mono { font-family: ui-monospace, monospace; font-size: .75rem; }
  .cap-consent-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .cap-btn { font: inherit; font-size: .9375rem; min-height: 40px; padding: 0 16px; border: 1px solid var(--consent-line); border-radius: 6px; background: Canvas; color: CanvasText; cursor: pointer; }
  .cap-btn[data-variant="primary"] { background: CanvasText; border-color: CanvasText; color: Canvas; }
  .cap-btn:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
`;

// The consent POST is reachable without credentials, so its body is checked to be the form and bounded before parsing.
const CONSENT_FORM_MAX_BYTES = 65_536;

const NOT_CONFIGURED =
  "This server is not configured for sign-in: ACCESS_TEAM_DOMAIN, ACCESS_SAAS_CLIENT_ID or " +
  "ACCESS_SAAS_CLIENT_SECRET is unset. Not configured means not open.";

/**
 * The provider's defaultHandler: /health, the consent page and form on /authorize, the Access /callback, and /owner
 * unless `owner` is false. A missing Access setting answers 503 on every sign-in route.
 * @template {LoginEnv} E
 * @param {LoginOptions<E>} options
 */
export function loginHandler({
  name,
  scopes,
  about,
  admit,
  admits = {
    refusal: `This account is not the administrator of ${name}.`,
  },
  wantsWrite = (requested) => requested.includes(scopes.write),
  health = (env) => healthResponse({ sha: deployedSha(env) }),
  audit,
  revokeExistingGrants = true,
  owner = true,
}) {
  const serverName = escape(name);
  // The owner page shares the sign-in and admission check.
  const ownerRoutes = owner
    ? ownerPage({ name, admit, server: audit, ...(typeof owner === "object" ? owner : {}) })
    : null;

  /**
   * One sign-in row, when the server keeps the log; a failed write is only reported.
   * @param {E} env @param {AuthRequest} request @param {string} caller @param {string} outcome @param {boolean} admitted
   */
  async function signInRow(env, request, caller, outcome, admitted) {
    if (!audit) return;
    await recordAudit(/** @type {Partial<import("./audit-log.mjs").AuditEnv>} */ (env), {
      callId: crypto.randomUUID(),
      phase: "sign-in",
      caller,
      result: { isError: !admitted, text: outcome },
      server: audit,
      clientId: request.clientId,
      correlationId: correlationId(),
    });
  }

  /**
   * Consent is a real form. Everything from the client is escaped (a CIMD name is chosen by whoever serves it);
   * `about` is the server's own HTML.
   * @param {ClientInfo | null} client @param {AuthRequest} request @param {string} handle
   */
  function consentPage(client, request, handle) {
    const label = escape(clientLabel(client, request.clientId));
    const target = describeRedirect(request.redirectUri);
    const redirectHost = escape(target.host);
    // A CIMD client's id is the URL its metadata is published at.
    const publisher = request.clientId.startsWith("https://")
      ? `Published by <strong>${escape(new URL(request.clientId).hostname)}</strong>.`
      : "This client registered itself, so its name is its own claim, not checked.";
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Allow ${label} to use ${serverName}?</title>
<style>${CONSENT_STYLE}</style>
</head><body>
<main id="main" tabindex="-1" class="cap-consent">
<section class="cap-panel"><div class="cap-consent-body">
<h1 class="cap-consent-title">Allow ${label} to use ${serverName}?</h1>
<p class="cap-consent-text">${publisher} Its access will be sent to <strong>${redirectHost}</strong>.</p>
${target.local ? `<div class="cap-alert" data-tone="warn" role="alert"><span class="cap-alert-text"><strong>${LOCAL_REDIRECT_WARNING[0]}</strong> ${LOCAL_REDIRECT_WARNING[1]}</span></div>\n` : ""}${about.trim()}
<form method="post" class="cap-consent-form">
  <input type="hidden" name="handle" value="${escape(handle)}">
  <div class="cap-consent-box"><label class="cap-check"><input type="checkbox" name="allow_write" value="1"${wantsWrite(request.scope) ? " checked" : ""}>
  <span><strong>Allow changes</strong><span class="cap-consent-line">Without this, ${label} can only read.</span><span class="cap-consent-line cap-consent-mono">${escape(scopes.write)}</span></span></label></div>
  <div class="cap-consent-actions">
  <button class="cap-btn" data-variant="primary" data-size="lg" name="decision" value="approve">Continue to sign in</button>
  <button class="cap-btn" data-size="lg" name="decision" value="deny">Deny</button>
  </div>
</form>
</div></section>
</main>
</body></html>`;
  }

  /** @param {Request} request @param {E} env */
  async function authorizeGet(request, env) {
    if (!accessSaas(env)) return respond(NOT_CONFIGURED, 503);
    const oauth = env.OAUTH_PROVIDER;
    const authRequest = await oauth.parseAuthRequest(request);
    if (!authRequest.codeChallenge) {
      return respond("PKCE is required: send code_challenge with code_challenge_method=S256.", 400);
    }
    const client = await oauth.lookupClient(authRequest.clientId);
    if (!client) return respond("Unknown OAuth client.", 400);
    const consent = await oauth.beginConsent(authRequest);
    consent.headers.set("content-type", "text/html; charset=utf-8");
    consent.headers.set("cache-control", PRIVATE_PAGE_HEADERS["Cache-Control"]);
    // A consent page another site can frame can be clickjacked into an approval.
    consent.headers.set("content-security-policy", "frame-ancestors 'none'");
    consent.headers.set("x-frame-options", "DENY");
    return compressUntransformed(
      new Response(consentPage(client, authRequest, consent.handle), { headers: consent.headers }),
      request,
    );
  }

  /** @param {Request} request @param {E} env */
  async function authorizePost(request, env) {
    const saas = accessSaas(env);
    if (!saas) return respond(NOT_CONFIGURED, 503);
    if (
      !(request.headers.get("content-type") ?? "")
        .toLowerCase()
        .startsWith("application/x-www-form-urlencoded")
    ) {
      return respond("The consent form is posted as application/x-www-form-urlencoded.", 415);
    }
    const body = await readCapped(request, CONSENT_FORM_MAX_BYTES);
    if (body === null)
      return respond(`The consent form is larger than ${CONSENT_FORM_MAX_BYTES} bytes.`, 413);
    const oauth = env.OAUTH_PROVIDER;
    const form = new URLSearchParams(body);
    const handle = String(form.get("handle") ?? "");
    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(request, handle);
      return redirectResponse(denied.redirectTo, 302, denied.headers);
    }
    const scope = form.get("allow_write") === "1" ? [scopes.read, scopes.write] : [scopes.read];
    const approved = await oauth.approveConsent(request, handle, { scope });
    const signIn = newSignIn();
    const { state, headers } = await oauth.beginUpstream(
      { ...approved.request, scope },
      { data: signIn, headers: approved.headers },
    );
    return redirectResponse(
      await authorizationUrl(saas, {
        redirectUri: `${originOf(request, env)}/callback`,
        state,
        ...signIn,
      }),
      302,
      headers,
    );
  }

  /** @param {Request} request @param {E} env */
  async function callback(request, env) {
    const saas = accessSaas(env);
    if (!saas) return respond(NOT_CONFIGURED, 503);
    const oauth = env.OAUTH_PROVIDER;
    const { request: original, data, headers } = await oauth.finishUpstream(request);
    const { verifier, nonce } = /** @type {{ verifier: string, nonce: string }} */ (data);
    const code = new URL(request.url).searchParams.get("code");
    if (!code)
      return redirectError(original, "Sign-in with Cloudflare Access did not complete.", headers);

    const signedIn = await finishSignIn(saas, {
      code,
      redirectUri: `${originOf(request, env)}/callback`,
      verifier,
      nonce,
    });
    if (!signedIn.ok) {
      console.warn(JSON.stringify({ door: "refused", reason: signedIn.reason }));
      await signInRow(env, original, "unknown", signedIn.reason, false);
      return redirectError(original, "Cloudflare Access did not confirm the sign-in.", headers);
    }
    const admitted = await admit(env, signedIn);
    if (!admitted) {
      console.warn(JSON.stringify({ door: "refused", reason: "not-admitted" }));
      await signInRow(env, original, `access:${signedIn.email}`, "not-admitted", false);
      return redirectError(original, admits.refusal, headers);
    }
    // An object admits and travels with the grant, read again on every request.
    const extra = typeof admitted === "object" ? admitted : {};

    const granted = original.scope.includes(scopes.write)
      ? [scopes.read, scopes.write]
      : [scopes.read];
    const client = clientLabel(
      await oauth.lookupClient(original.clientId).catch(() => null),
      original.clientId,
    );
    const { redirectTo } = await oauth.completeAuthorization({
      request: original,
      userId: signedIn.email.toLowerCase(),
      metadata: { email: signedIn.email, client },
      scope: granted,
      props: {
        ...extra,
        email: signedIn.email,
        scopes: granted,
        client,
        clientId: original.clientId,
      },
      revokeExistingGrants,
    });
    await signInRow(
      env,
      original,
      `access:${signedIn.email}`,
      `granted ${granted.join(" ")}`,
      true,
    );
    return redirectResponse(redirectTo, 302, headers);
  }

  return {
    /** @param {Request} request @param {E} env @returns {Promise<Response>} */
    async fetch(request, env) {
      const { pathname } = new URL(request.url);
      try {
        if (pathname === "/health") return await health(env);
        if (pathname === "/authorize" && request.method === "GET")
          return await authorizeGet(request, env);
        if (pathname === "/authorize" && request.method === "POST")
          return await authorizePost(request, env);
        if (pathname === "/callback" && request.method === "GET") {
          return ownerRoutes?.isOwnerCallback(request)
            ? await ownerRoutes.callback(request, env)
            : await callback(request, env);
        }
        const owned = await ownerRoutes?.fetch(request, env);
        if (owned) return owned;
        return respond("Not found.", 404);
      } catch (error) {
        if (error instanceof Error && error.name === "AuthorizationError") {
          const failure =
            /** @type {Error & { code: string, description: string, redirectUri?: string, state?: string, issuer?: string }} */ (
              error
            );
          if (!failure.redirectUri)
            return respond(
              `${failure.description} Start the sign-in again from your MCP client.`,
              400,
            );
          const url = new URL(failure.redirectUri);
          url.searchParams.set("error", failure.code);
          url.searchParams.set("error_description", failure.description);
          if (failure.state) url.searchParams.set("state", failure.state);
          if (failure.issuer) url.searchParams.set("iss", failure.issuer);
          return redirectResponse(url.href);
        }
        if (error instanceof Error && error.name === "CimdFetchError") {
          return respond(
            "This client could not be verified: its client metadata document could not be fetched.",
            400,
          );
        }
        throw error;
      }
    },
  };
}

/**
 * Whether a signed-in email is an administrator's: `ADMIN_EMAIL` or an entry of `CO_OWNER_EMAILS`, compared without
 * case (`isAdminEmail`, ./access). The email is the one Cloudflare Access verified. Fails closed: an unset or blank
 * `ADMIN_EMAIL` admits nobody.
 * @param {{ ADMIN_EMAIL?: string, CO_OWNER_EMAILS?: string }} env
 * @param {{ email?: unknown }} user
 */
export function isAdminUser(env, user) {
  return isAdminEmail(env, user.email);
}

export {
  DCR_CALLBACKS,
  allowedRedirects,
  registrationLimited,
  registrationRefusal,
} from "./mcp-registration.mjs";
