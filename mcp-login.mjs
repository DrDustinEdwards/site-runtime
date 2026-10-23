/**
 * The consent page and the upstream sign-in of a single-administrator MCP server, behind
 * @cloudflare/workers-oauth-provider, and the tightened check on a dynamic client registration.
 *
 * The provider makes the Worker an OAuth 2.1 authorization server for MCP clients. It does not know who the human is,
 * so after consent this handler sends them to Cloudflare Access for SaaS (`./access-login`) and lets in only the email
 * the caller's `admit` accepts.
 *
 * The consent handle and the upstream state are the provider's own helpers (beginConsent, approveConsent,
 * beginUpstream, finishUpstream): each is bound to the browser by a cookie the library sets and works once, so another
 * site cannot submit consent or replay a callback. The PKCE verifier and nonce travel in the upstream state,
 * server-side.
 *
 * Least scope first: the write box starts ticked only when the client asked for the write scope, the grant is what the
 * administrator ticked, never what the client asked, and every grant holds the read scope.
 *
 * The provider is matched by its errors' names, not imported, so this package keeps no dependencies.
 */

import { accessSaas, authorizationUrl, finishSignIn, newSignIn } from "./access-login.mjs";
import { escapeHtml as escape } from "./html.mjs";

/** @typedef {import("./mcp-login.d.mts").LoginEnv} LoginEnv */
/** @typedef {import("@cloudflare/workers-oauth-provider").AuthRequest} AuthRequest */
/** @typedef {import("@cloudflare/workers-oauth-provider").ClientInfo} ClientInfo */

// Caching and indexing: an authenticated operator surface is never cached or indexed.
const PRIVATE_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
};

/** @param {string} body @param {number} [status] @param {Headers} [headers] */
function text(body, status = 200, headers) {
  const out = new Headers(headers);
  out.set("content-type", "text/plain; charset=utf-8");
  for (const [name, value] of Object.entries(PRIVATE_HEADERS)) out.set(name, value);
  return new Response(body, { status, headers: out });
}

/** @param {string} location @param {Headers} [headers] */
function redirect(location, headers) {
  const out = new Headers(headers);
  out.set("location", location);
  out.set("cache-control", "no-store");
  return new Response(null, { status: 302, headers: out });
}

/**
 * The OAuth error answer to the client, once its redirect URI is known good.
 * @param {AuthRequest} request @param {string} description @param {Headers} [headers]
 */
function redirectError(request, description, headers) {
  const url = new URL(request.redirectUri);
  url.searchParams.set("error", "access_denied");
  url.searchParams.set("error_description", description);
  url.searchParams.set("state", request.state);
  if (request.issuer) url.searchParams.set("iss", request.issuer);
  return redirect(url.href, headers);
}

/** @param {Request} request @param {LoginEnv} env */
function origin(request, env) {
  return (env.PUBLIC_ORIGIN?.trim() || new URL(request.url).origin).replace(/\/+$/, "");
}

/**
 * The name a client is shown by: its own client_name, or the host that publishes its metadata.
 * @param {ClientInfo | null} client @param {string} clientId
 */
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
 * The consent page's one inline <style>. The page renders this exact string between the tags, so a server's
 * Content-Security-Policy trusts it by hash (`scriptHash(CONSENT_STYLE)` from `./csp`) and the two cannot drift.
 */
export const CONSENT_STYLE = `
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 system-ui, sans-serif; max-width: 34rem; margin: 4rem auto; padding: 0 1.25rem; }
  h1 { font-size: 1.35rem; line-height: 1.3; }
  label { display: inline-flex; gap: .5rem; align-items: center; min-height: 24px; }
  button { font: inherit; padding: .55rem 1.1rem; border-radius: .35rem; cursor: pointer; margin-right: .5rem; min-height: 24px; }
`;

const NOT_CONFIGURED =
  "This server is not configured for sign-in: ACCESS_TEAM_DOMAIN, ACCESS_SAAS_CLIENT_ID or " +
  "ACCESS_SAAS_CLIENT_SECRET is unset. Not configured means not open.";

/**
 * The provider's defaultHandler: /health, the consent page and its form on /authorize, and the Access /callback. A
 * missing Access setting answers 503 on every sign-in route.
 * @template {LoginEnv} E
 * @param {import("./mcp-login.d.mts").LoginOptions<E>} options
 */
export function loginHandler({ name, scopes, about, admit }) {
  const serverName = escape(name);

  /**
   * Consent has to be an act, so it is a real form. Everything from the client is escaped: a CIMD document's name is
   * chosen by whoever serves it, a registered client's by its registrant. `about` is the server's own HTML.
   * @param {ClientInfo | null} client @param {AuthRequest} request @param {string} handle
   */
  function consentPage(client, request, handle) {
    const label = escape(clientLabel(client, request.clientId));
    const redirectHost = escape(new URL(request.redirectUri).hostname);
    const wantsWrite = request.scope.includes(scopes.write);
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Allow ${label} to use ${serverName}?</title>
<style>${CONSENT_STYLE}</style>
</head><body>
<h1>Allow ${label} to use ${serverName}?</h1>
<p>Its access will be sent to <strong>${redirectHost}</strong>.</p>
${about.trim()}
<p>Next you sign in with Cloudflare Access. Only the configured administrator is accepted.</p>
<form method="post">
  <input type="hidden" name="handle" value="${escape(handle)}">
  <p><label><input type="checkbox" name="allow_write" value="1"${wantsWrite ? " checked" : ""}>
  Allow changes (${escape(scopes.write)})</label></p>
  <button name="decision" value="approve">Continue to sign in</button>
  <button name="decision" value="deny">Deny</button>
</form>
</body></html>`;
  }

  /** @param {Request} request @param {E} env */
  async function authorizeGet(request, env) {
    if (!accessSaas(env)) return text(NOT_CONFIGURED, 503);
    const oauth = env.OAUTH_PROVIDER;
    const authRequest = await oauth.parseAuthRequest(request);
    const client = await oauth.lookupClient(authRequest.clientId);
    if (!client) return text("Unknown OAuth client.", 400);
    const consent = await oauth.beginConsent(authRequest);
    consent.headers.set("content-type", "text/html; charset=utf-8");
    // no-transform keeps Cloudflare from injecting anything into this page.
    consent.headers.set("cache-control", "no-store, no-transform");
    return new Response(consentPage(client, authRequest, consent.handle), { headers: consent.headers });
  }

  /** @param {Request} request @param {E} env */
  async function authorizePost(request, env) {
    const saas = accessSaas(env);
    if (!saas) return text(NOT_CONFIGURED, 503);
    const oauth = env.OAUTH_PROVIDER;
    const form = await request.formData();
    const handle = String(form.get("handle") ?? "");
    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(request, handle);
      return redirect(denied.redirectTo, denied.headers);
    }
    const scope = form.get("allow_write") === "1" ? [scopes.read, scopes.write] : [scopes.read];
    const approved = await oauth.approveConsent(request, handle, { scope });
    const signIn = newSignIn();
    const { state, headers } = await oauth.beginUpstream({ ...approved.request, scope }, { data: signIn, headers: approved.headers });
    return redirect(await authorizationUrl(saas, { redirectUri: `${origin(request, env)}/callback`, state, ...signIn }), headers);
  }

  /** @param {Request} request @param {E} env */
  async function callback(request, env) {
    const saas = accessSaas(env);
    if (!saas) return text(NOT_CONFIGURED, 503);
    const oauth = env.OAUTH_PROVIDER;
    const { request: original, data, headers } = await oauth.finishUpstream(request);
    const { verifier, nonce } = /** @type {{ verifier: string, nonce: string }} */ (data);
    const code = new URL(request.url).searchParams.get("code");
    if (!code) return redirectError(original, "Sign-in with Cloudflare Access did not complete.", headers);

    const signedIn = await finishSignIn(saas, { code, redirectUri: `${origin(request, env)}/callback`, verifier, nonce });
    if (!signedIn.ok) {
      console.warn(JSON.stringify({ door: "refused", reason: signedIn.reason }));
      return redirectError(original, "Cloudflare Access did not confirm the sign-in.", headers);
    }
    if (!(await admit(env, signedIn))) {
      console.warn(JSON.stringify({ door: "refused", reason: "not-the-administrator" }));
      return redirectError(original, `This account is not the administrator of ${name}.`, headers);
    }

    const granted = original.scope.includes(scopes.write) ? [scopes.read, scopes.write] : [scopes.read];
    const { redirectTo } = await oauth.completeAuthorization({
      request: original,
      userId: signedIn.email.toLowerCase(),
      metadata: { email: signedIn.email },
      scope: granted,
      props: { email: signedIn.email, scopes: granted },
    });
    return redirect(redirectTo, headers);
  }

  return {
    /** @param {Request} request @param {E} env @returns {Promise<Response>} */
    async fetch(request, env) {
      const { pathname } = new URL(request.url);
      try {
        if (pathname === "/health") return text("ok");
        if (pathname === "/authorize" && request.method === "GET") return await authorizeGet(request, env);
        if (pathname === "/authorize" && request.method === "POST") return await authorizePost(request, env);
        if (pathname === "/callback" && request.method === "GET") return await callback(request, env);
        return text("Not found.", 404);
      } catch (error) {
        // Redirect only to a validated client; render the rest.
        if (error instanceof Error && error.name === "AuthorizationError") {
          const failure = /** @type {Error & { code: string, description: string, redirectUri?: string, state?: string, issuer?: string }} */ (error);
          if (!failure.redirectUri) return text(`${failure.description} Start the sign-in again from your MCP client.`, 400);
          const url = new URL(failure.redirectUri);
          url.searchParams.set("error", failure.code);
          url.searchParams.set("error_description", failure.description);
          if (failure.state) url.searchParams.set("state", failure.state);
          if (failure.issuer) url.searchParams.set("iss", failure.issuer);
          return redirect(url.href);
        }
        if (error instanceof Error && error.name === "CimdFetchError") {
          return text("This client could not be verified: its client metadata document could not be fetched.", 400);
        }
        throw error;
      }
    },
  };
}

/**
 * Whether a signed-in email is the single administrator's: `ADMIN_EMAIL`, compared without case. The email is the one
 * Cloudflare Access verified. Fails closed: an unset or blank value admits nobody.
 * @param {{ ADMIN_EMAIL?: string }} env
 * @param {{ email?: unknown }} user
 */
export function isAdminUser(env, user) {
  const admin = (env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!admin || typeof user.email !== "string") return false;
  return user.email.trim().toLowerCase() === admin;
}

/**
 * The redirect URIs a dynamically registered client may name, from a comma-separated setting (DCR_REDIRECT_URIS).
 * @param {string | undefined} configured
 */
export function allowedRedirects(configured) {
  return (configured ?? "")
    .split(",")
    .map((uri) => uri.trim())
    .filter(Boolean);
}

/**
 * The tightened Dynamic Client Registration check, for the provider's clientRegistrationCallback. DCR is kept only
 * for the clients that still need it (Grok, Gemini), so a registration is allowed only when every redirect URI it
 * names is listed, character for character, in `configured`: a redirect URI is where an authorization code is
 * delivered, and close to an allowed one is how codes are stolen. An empty or unset list refuses every registration.
 * Registration grants nothing; the consent page, Access and the administrator check still decide.
 * @param {string | undefined} configured
 * @param {Record<string, unknown>} clientMetadata
 * @returns {string | null} null when the registration may proceed, else why it is refused, naming the URI
 */
export function registrationRefusal(configured, clientMetadata) {
  const allowed = allowedRedirects(configured);
  if (allowed.length === 0) return "Dynamic client registration is closed on this server: no redirect URI is allowlisted.";
  const asked = clientMetadata.redirect_uris;
  if (!Array.isArray(asked) || asked.length === 0) return "A registration must name at least one redirect URI.";
  for (const uri of asked) {
    if (typeof uri !== "string" || !allowed.includes(uri)) return `The redirect URI ${JSON.stringify(uri)} is not allowlisted on this server.`;
  }
  return null;
}
