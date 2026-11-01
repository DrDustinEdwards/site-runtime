/**
 * The owner page of an MCP server (checklist A15 and L9): the signed-in administrator's grants, each with Revoke, the
 * named agent keys the Worker holds, and the tool-call log, newest first. It is how the owner sees who can reach the
 * server and what was done, without the Cloudflare dashboard.
 *
 * `loginHandler` (./mcp-login) serves it at /owner on every server it fronts. A server with its own pages (Capsid's
 * Portal, Carrel's Desk) uses the helpers below for the same data: `listOwnerGrants`, `revokeOwnerGrant`,
 * `readAuditLog` and ./agent-keys' `agentKeyNames`.
 *
 * SIGN-IN. The same Cloudflare Access for SaaS round trip as the consent page, through the same /callback (the address
 * the Access application already allows), told apart by a state that starts `owner.`. The state, PKCE verifier and
 * nonce are kept in OAUTH_KV for ten minutes under the state, and the state is also a cookie, so a callback another
 * browser started is refused (login CSRF). The caller's `admit` decides who is let in, as for consent.
 *
 * SESSION. A random id in an HttpOnly, Secure, SameSite=Lax `__Host-` cookie; OAUTH_KV keeps its SHA-256 for 30
 * minutes with the email and a CSRF token. Lax, not Strict, because the session starts on the redirect back from
 * Access, a navigation from another site. Every change is a POST that carries the CSRF token and a same-origin Origin.
 *
 * REVOKE. Only a grant of the signed-in user can be revoked (the provider keys grants by user), and each revoke writes
 * a `revoked` row to the tool-call log when the server keeps one.
 */

import { accessSaas, authorizationUrl, finishSignIn, newSignIn } from "./access-login.mjs";
import { AGENT_KEY_PREFIX, agentKeyNames } from "./agent-keys.mjs";
import { correlationId, recordAudit } from "./audit-log.mjs";
import { readCapped } from "./body.mjs";
import { safeEqual } from "./compare.mjs";
import { sha256Hex, toHex } from "./encoding.mjs";
import { escapeHtml as escape } from "./html.mjs";

/** @typedef {import("@cloudflare/workers-oauth-provider").OAuthHelpers} OAuthHelpers */
/** @typedef {import("@cloudflare/workers-oauth-provider").GrantSummary} GrantSummary */
/** @typedef {import("./owner-page.d.mts").OwnerEnv} OwnerEnv */
/** @typedef {import("./owner-page.d.mts").AuditLogRow} AuditLogRow */

export const OWNER_PATH = "/owner";
const STATE_PREFIX = "owner.";
const SIGN_IN_COOKIE = "__Host-owner-sign-in";
const SESSION_COOKIE = "__Host-owner";
const SIGN_IN_SECONDS = 600;
const SESSION_SECONDS = 1800;
const FORM_MAX_BYTES = 4096;
const LOG_PAGE = 50;
const GRANT_PAGES = 10;

const PRIVATE_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
  "content-security-policy": "frame-ancestors 'none'",
  "x-frame-options": "DENY",
};

/** @param {string} body @param {number} [status] @param {string} [type] @param {Headers} [headers] */
function respond(body, status = 200, type = "text/plain; charset=utf-8", headers) {
  const out = new Headers(headers);
  out.set("content-type", type);
  for (const [name, value] of Object.entries(PRIVATE_HEADERS)) out.set(name, value);
  return new Response(body, { status, headers: out });
}

/** @param {string} location @param {Headers} [headers] */
function seeOther(location, headers) {
  const out = new Headers(headers);
  out.set("location", location);
  out.set("cache-control", "no-store");
  return new Response(null, { status: 303, headers: out });
}

/** @param {Request} request @param {string} name */
function cookie(request, name) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

/** @param {string} name @param {string} value @param {number} maxAge */
function setCookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

const randomId = () => toHex(crypto.getRandomValues(new Uint8Array(32)));

/** @param {Request} request @param {{ PUBLIC_ORIGIN?: string }} env */
function originOf(request, env) {
  return (env.PUBLIC_ORIGIN?.trim() || new URL(request.url).origin).replace(/\/+$/, "");
}

/**
 * Every grant the user holds on this server, newest first: up to ten pages of the provider's list.
 * @param {OAuthHelpers} oauth
 * @param {string} userId
 * @returns {Promise<GrantSummary[]>}
 */
export async function listOwnerGrants(oauth, userId) {
  /** @type {GrantSummary[]} */
  const grants = [];
  /** @type {string | undefined} */
  let cursor;
  for (let page = 0; page < GRANT_PAGES; page++) {
    const result = await oauth.listUserGrants(userId, { limit: 100, cursor });
    grants.push(...result.items);
    cursor = result.cursor;
    if (!cursor) break;
  }
  return grants.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Revokes one of the user's grants and logs it: the provider refuses a grant id another user holds by finding nothing
 * under this user. Answers false when the user holds no such grant.
 * @param {Partial<import("./audit-log.d.mts").AuditEnv>} env
 * @param {OAuthHelpers} oauth
 * @param {{ userId: string, grantId: string, caller: string, server?: { name: string, version: string } }} input
 */
export async function revokeOwnerGrant(env, oauth, { userId, grantId, caller, server }) {
  const grant = (await listOwnerGrants(oauth, userId)).find((g) => g.id === grantId);
  if (!grant) return false;
  await oauth.revokeGrant(grantId, userId);
  if (env.TOOL_CALL_LOG) {
    await recordAudit(env, {
      callId: crypto.randomUUID(),
      phase: "revoked",
      caller,
      args: { grant: grantId, scope: grant.scope.join(" ") },
      server,
      clientId: grant.clientId,
      correlationId: correlationId(),
    });
  }
  return true;
}

/**
 * One page of the tool-call log, newest first: `limit` rows (at most 100) before the row `before`, or the newest.
 * @param {Partial<import("./audit-log.d.mts").AuditEnv>} env
 * @param {{ before?: number, limit?: number }} [options]
 * @returns {Promise<AuditLogRow[]>}
 */
export async function readAuditLog(env, { before, limit = LOG_PAGE } = {}) {
  const ns = /** @type {any} */ (env.TOOL_CALL_LOG);
  if (!ns) throw new Error("the TOOL_CALL_LOG binding is missing");
  const url = new URL("https://tool-call-log.invalid/recent");
  url.searchParams.set("limit", String(limit));
  if (before) url.searchParams.set("before", String(before));
  const response = await ns.get(ns.idFromName("tool-calls")).fetch(url.href);
  if (!response.ok) throw new Error(`the tool-call log answered ${response.status}`);
  return /** @type {any} */ (await response.json()).rows;
}

/** @param {number | undefined} ms */
const when = (ms) => (ms ? new Date(ms * (ms < 1e12 ? 1000 : 1)).toISOString().replace("T", " ").slice(0, 16) : "never");

/** @param {string | null} json */
function resultLine(json) {
  if (!json) return "";
  try {
    const result = JSON.parse(json);
    const line = String(result.text ?? "").replace(/\s+/g, " ").slice(0, 140);
    return `${result.isError ? "Error: " : ""}${line}`;
  } catch {
    return "";
  }
}

/**
 * The page. Everything a client or a caller chose (a client name, a tool's result) is escaped.
 * @param {{ name: string, email: string, csrf: string, grants: GrantSummary[], keys: string[], log: AuditLogRow[] | null | "owner", before: number | null, notice: string }} view
 */
function page({ name, email, csrf, grants, keys, log, before, notice }) {
  const server = escape(name);
  const token = `<input type="hidden" name="csrf" value="${escape(csrf)}">`;
  const grantRows = grants
    .map((g) => {
      const client = escape(String(g.metadata?.client ?? g.clientId));
      return `<tr><td>${client}<br><small>${escape(g.clientId)}</small></td><td>${escape(g.scope.join(" "))}</td><td>${when(g.createdAt)}</td><td>${when(g.expiresAt)}</td>
<td><form method="post" action="${OWNER_PATH}/revoke">${token}<input type="hidden" name="grant" value="${escape(g.id)}"><button>Revoke</button></form></td></tr>`;
    })
    .join("\n");
  const keyRows = keys.map((k) => `<li><code>${escape(k)}</code> (Worker secret <code>${AGENT_KEY_PREFIX}${escape(k.toUpperCase())}</code>)</li>`).join("\n");
  const rows = Array.isArray(log) ? log : [];
  const logRows = rows
    .map(
      (r) =>
        `<tr><td>${escape(String(r.at).replace("T", " ").slice(0, 19))}</td><td>${escape(r.phase)}</td><td>${escape(r.caller)}</td><td>${escape(r.tool)}</td><td>${escape(resultLine(r.result))}</td></tr>`,
    )
    .join("\n");
  const oldest = rows.at(-1)?.seq;
  const older = rows.length === LOG_PAGE && oldest ? `<p><a href="${OWNER_PATH}?before=${oldest}">Older calls</a></p>` : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${server}: grants and tool calls</title>
<style>${OWNER_STYLE}</style>
</head><body>
<h1>${server}: grants and tool calls</h1>
<p>Signed in as <strong>${escape(email)}</strong>.</p>
<form method="post" action="${OWNER_PATH}/sign-out">${token}<button>Sign out</button></form>
${notice ? `<p role="status"><strong>${escape(notice)}</strong></p>` : ""}
<h2>Your grants</h2>
${
  grants.length
    ? `<p>Each AI client you allowed. Revoke ends its access at once; it has to ask you again.</p>
<div class="scroll"><table><thead><tr><th>Client</th><th>Scopes</th><th>Granted (UTC)</th><th>Expires</th><th></th></tr></thead><tbody>
${grantRows}
</tbody></table></div>`
    : "<p>No AI client holds a grant from you here.</p>"
}
<h2>Agent keys</h2>
${
  keys.length
    ? `<p>Agents that sign in with a key instead of OAuth. A key is revoked by deleting its Worker secret.</p>\n<ul>\n${keyRows}\n</ul>`
    : "<p>This server holds no agent keys.</p>"
}
<h2>Tool calls${before ? " (older)" : ""}</h2>
${
  log === null
    ? "<p>This server keeps no tool-call log.</p>"
    : log === "owner"
      ? "<p>The tool-call log holds everyone's calls, so only the server's owner reads it.</p>"
      : rows.length
      ? `<p>Newest first, times in UTC. Older rows are in the daily copy in R2.</p>
<div class="scroll"><table><thead><tr><th>Time</th><th>Event</th><th>Caller</th><th>Tool</th><th>Result</th></tr></thead><tbody>
${logRows}
</tbody></table></div>
${older}`
      : "<p>No calls yet.</p>"
}
${before ? `<p><a href="${OWNER_PATH}">Newest calls</a></p>` : ""}
</body></html>`;
}

/**
 * The owner page's one inline <style>, rendered exactly so a Content-Security-Policy can trust it by hash
 * (./mcp-server's `withMcpHeaders` does).
 */
export const OWNER_STYLE = `
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 system-ui, sans-serif; max-width: 72rem; margin: 2.5rem auto; padding: 0 1rem; }
  h1 { font-size: 1.35rem; line-height: 1.3; }
  h2 { font-size: 1.1rem; margin-top: 2rem; }
  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: .9rem; }
  th, td { text-align: left; vertical-align: top; padding: .4rem .6rem .4rem 0; border-bottom: 1px solid color-mix(in srgb, currentColor 20%, transparent); }
  td { overflow-wrap: anywhere; }
  small { opacity: .75; }
  button { font: inherit; padding: .35rem .9rem; border-radius: .35rem; cursor: pointer; min-height: 24px; }
`;

/**
 * The owner page's routes for a server's defaultHandler: GET /owner, POST /owner/revoke and /owner/sign-out, and the
 * /callback of an owner sign-in. `fetch` answers null for any other request.
 * @template {OwnerEnv} E
 * @param {{ name: string, admit(env: E, user: { email: string, name?: string }): unknown, server?: { name: string, version: string }, readsLog?(env: E, email: string): boolean | Promise<boolean> }} options
 */
export function ownerPage({ name, admit, server, readsLog = () => true }) {
  /** @param {Request} request @param {E} env */
  async function session(request, env) {
    const id = cookie(request, SESSION_COOKIE);
    if (!id || !/^[0-9a-f]{64}$/.test(id)) return null;
    const stored = await env.OAUTH_KV.get(`owner:session:${await sha256Hex(id)}`);
    return stored ? /** @type {{ email: string, csrf: string, log: boolean }} */ (JSON.parse(stored)) : null;
  }

  /** @param {Request} request @param {E} env */
  async function startSignIn(request, env) {
    const saas = accessSaas(env);
    if (!saas) return respond("This server is not configured for sign-in. Not configured means not open.", 503);
    const state = `${STATE_PREFIX}${randomId()}`;
    const signIn = newSignIn();
    await env.OAUTH_KV.put(`owner:sign-in:${state}`, JSON.stringify(signIn), { expirationTtl: SIGN_IN_SECONDS });
    const to = await authorizationUrl(saas, { redirectUri: `${originOf(request, env)}/callback`, state, ...signIn });
    return seeOther(to, new Headers({ "set-cookie": setCookie(SIGN_IN_COOKIE, state, SIGN_IN_SECONDS) }));
  }

  /** @param {Request} request @param {E} env */
  async function callback(request, env) {
    const url = new URL(request.url);
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code");
    const bound = cookie(request, SIGN_IN_COOKIE);
    if (!bound || !(await safeEqual(bound, state))) return respond("This sign-in was started in another browser. Open the owner page again.", 400);
    const key = `owner:sign-in:${state}`;
    const stored = await env.OAUTH_KV.get(key);
    if (!stored) return respond("This sign-in has expired. Open the owner page again.", 400);
    await env.OAUTH_KV.delete(key);
    const saas = accessSaas(env);
    if (!saas) return respond("This server is not configured for sign-in. Not configured means not open.", 503);
    if (!code) return respond("Sign-in with Cloudflare Access did not complete.", 400);
    const { verifier, nonce } = JSON.parse(stored);
    const signedIn = await finishSignIn(saas, { code, redirectUri: `${originOf(request, env)}/callback`, verifier, nonce });
    const admitted = signedIn.ok && (await admit(env, signedIn));
    if (env.TOOL_CALL_LOG) {
      await recordAudit(env, {
        callId: crypto.randomUUID(),
        phase: "sign-in",
        caller: signedIn.ok ? `access:${signedIn.email}` : "unknown",
        tool: "",
        result: { isError: !admitted, text: signedIn.ok ? (admitted ? "owner page" : "owner page: not-admitted") : `owner page: ${signedIn.reason}` },
        server,
        correlationId: correlationId(),
      });
    }
    if (!signedIn.ok || !admitted) return respond(`This account cannot open the owner page of ${name}.`, 403);
    const id = randomId();
    const email = signedIn.email.toLowerCase();
    const log = (await readsLog(env, email)) === true;
    await env.OAUTH_KV.put(`owner:session:${await sha256Hex(id)}`, JSON.stringify({ email, csrf: randomId(), log }), {
      expirationTtl: SESSION_SECONDS,
    });
    const headers = new Headers();
    headers.append("set-cookie", setCookie(SESSION_COOKIE, id, SESSION_SECONDS));
    headers.append("set-cookie", setCookie(SIGN_IN_COOKIE, "", 0));
    return seeOther(OWNER_PATH, headers);
  }

  /**
   * A POST's form, when it is same-origin and carries the session's CSRF token; else the refusal.
   * @param {Request} request @param {E} env @param {{ csrf: string }} signedIn
   */
  async function postedForm(request, env, signedIn) {
    const from = request.headers.get("origin");
    if (from !== originOf(request, env)) return respond("This form must be sent from the owner page.", 403);
    const body = await readCapped(request, FORM_MAX_BYTES);
    if (body === null) return respond("The form is too large.", 413);
    const form = new URLSearchParams(body);
    if (!(await safeEqual(String(form.get("csrf") ?? ""), signedIn.csrf))) return respond("This form has expired. Open the owner page again.", 403);
    return form;
  }

  return {
    /** Whether a /callback belongs to an owner sign-in. @param {Request} request */
    isOwnerCallback(request) {
      return (new URL(request.url).searchParams.get("state") ?? "").startsWith(STATE_PREFIX);
    },
    callback,
    /** @param {Request} request @param {E} env @returns {Promise<Response | null>} */
    async fetch(request, env) {
      const url = new URL(request.url);
      if (url.pathname !== OWNER_PATH && !url.pathname.startsWith(`${OWNER_PATH}/`)) return null;
      const signedIn = await session(request, env);
      if (url.pathname === OWNER_PATH && request.method === "GET") {
        if (!signedIn) return startSignIn(request, env);
        const before = Number(url.searchParams.get("before")) || null;
        /** @type {AuditLogRow[] | null | "owner"} */
        let log = null;
        if (env.TOOL_CALL_LOG) log = signedIn.log ? await readAuditLog(env, { before: before ?? undefined }) : "owner";
        const notice = url.searchParams.get("revoked") ? "Grant revoked." : "";
        const html = page({ name, email: signedIn.email, csrf: signedIn.csrf, grants: await listOwnerGrants(env.OAUTH_PROVIDER, signedIn.email), keys: agentKeyNames(env), log, before, notice });
        return respond(html, 200, "text/html; charset=utf-8");
      }
      if (request.method !== "POST" || (url.pathname !== `${OWNER_PATH}/revoke` && url.pathname !== `${OWNER_PATH}/sign-out`)) return respond("Not found.", 404);
      if (!signedIn) return respond("Your owner session has ended. Open the owner page again.", 403);
      const form = await postedForm(request, env, signedIn);
      if (form instanceof Response) return form;
      if (url.pathname === `${OWNER_PATH}/sign-out`) {
        const id = cookie(request, SESSION_COOKIE) ?? "";
        await env.OAUTH_KV.delete(`owner:session:${await sha256Hex(id)}`);
        return respond(`Signed out of the owner page of ${name}.`, 200, undefined, new Headers({ "set-cookie": setCookie(SESSION_COOKIE, "", 0) }));
      }
      const grantId = String(form.get("grant") ?? "");
      const done = await revokeOwnerGrant(env, env.OAUTH_PROVIDER, { userId: signedIn.email, grantId, caller: `access:${signedIn.email}`, server });
      if (!done) return respond("You hold no such grant.", 404);
      return seeOther(`${OWNER_PATH}?revoked=1`);
    },
  };
}
