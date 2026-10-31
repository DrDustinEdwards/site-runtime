/**
 * The sign-in and access findings for one live site, from what an outside request can see (`bin/sign-in.mjs`). Each
 * finding names the item it fails in the reference checklist of the completeness plan (area 3), the URL that shows it
 * and what was seen. It sends no sign-in mail, makes no account and sends no real token: the only requests that change
 * anything are a passkey challenge (Better Auth stores one for five minutes) and a sign-out with no session.
 *
 * Each part runs only when the site has it, found by probing: a sign-in page (/login, /signin, /sign-in), Better Auth
 * (/api/auth/ok answers ok), admin pages (/admin, plus the registry's `signIn.admin`), an MCP server (/mcp answers 401,
 * plus the registry's `signIn.mcp`). What a site serves beyond its own /admin and /mcp is its entry's `signIn` in the
 * site registry (`./sites.mjs`), found by origin or alias. A site with none of them has no findings.
 */

import { siteForOrigin } from "./sites-values.mjs";

const UA = "Mozilla/5.0 (compatible; site-runtime-sign-in)";
const TIMEOUT_MS = 15_000;

/** Where a site's confirm page may be: next to each sign-in page found (txasm's is /signin/confirm), else /sign-in/confirm. */
const CONFIRM_PATHS = ["/sign-in/confirm", "/signin/confirm", "/login/confirm"];

/**
 * @typedef {{ url: string, status: number, headers: Headers, cookies: string[], body: string, error?: string }} Got
 * @typedef {{ item: string, severity: "error" | "warning", url: string, detail: string }} Finding
 */

/** One request, never followed. @returns {Promise<Got>} */
async function get(/** @type {string} */ url, /** @type {RequestInit} */ init = {}) {
  try {
    const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), ...init, headers: { "user-agent": UA, ...init.headers } });
    const body = /html|json|text/.test(r.headers.get("content-type") ?? "") ? await r.text() : (await r.arrayBuffer(), "");
    return { url, status: r.status, headers: r.headers, cookies: r.headers.getSetCookie(), body };
  } catch (error) {
    return { url, status: 0, headers: new Headers(), cookies: [], body: "", error: String(error?.cause?.code ?? error?.message ?? error) };
  }
}

/** A GET that follows redirects on the same origin, up to three. */
async function follow(/** @type {string} */ url) {
  let r = await get(url);
  for (let i = 0; i < 3 && r.status >= 300 && r.status < 400 && r.headers.get("location"); i++) {
    const next = new URL(/** @type {string} */ (r.headers.get("location")), r.url);
    if (next.origin !== new URL(url).origin) break;
    r = await get(next.href);
  }
  return r;
}

const json = (/** @type {Got} */ r) => {
  try {
    return JSON.parse(r.body);
  } catch {
    return null;
  }
};
const noStore = (/** @type {Got} */ r) => /no-store/i.test(r.headers.get("cache-control") ?? "");
const noindex = (/** @type {Got} */ r) =>
  /noindex/i.test(r.headers.get("x-robots-tag") ?? "") || [...r.body.matchAll(/<meta\b[^>]*>/gi)].some(([tag]) => /name=["']?robots/i.test(tag) && /noindex/i.test(tag));
/** A Set-Cookie that leaves a cookie in the browser (not one that deletes it). */
const keeps = (/** @type {string} */ cookie) => !/;\s*max-age=0\b/i.test(cookie) && !/;\s*expires=[^;]*19[67]\d/i.test(cookie);

/**
 * The findings for one site. Throws when the site does not answer, so an outage never reads as findings.
 * @param {{ origin: string, from?: string, probes?: import("./sites.mjs").SignInProbes }} site `probes` in place of the
 *   registry entry's `signIn`
 * @returns {Promise<{ findings: Finding[], found: string[] }>}
 */
export async function signInFindings({ origin, from, probes }) {
  origin = origin.replace(/\/$/, "");
  const base = (from ?? origin).replace(/\/$/, "");
  const host = new URL(origin).hostname;
  const elsewhere = probes ?? siteForOrigin(origin)?.signIn ?? {};
  const home = await get(`${base}/`);
  if (home.status === 0 || home.status >= 500) throw new Error(`${base} did not answer: ${home.error ?? home.status}`);

  /** @type {Finding[]} */
  const findings = [];
  /** @type {string[]} */
  const found = [];
  const flag = (/** @type {string} */ item, /** @type {"error" | "warning"} */ severity, /** @type {string} */ url, /** @type {string} */ detail) => findings.push({ item, severity, url, detail });
  const named = new Set();
  /** D1: every cookie an auth response sets is __Secure- or __Host-, HttpOnly, Secure and SameSite. Names only, never values. */
  const cookies = (/** @type {Got} */ r) => {
    for (const cookie of r.cookies) {
      const name = cookie.split("=")[0].trim();
      const missing = [
        /^__(Secure|Host)-/.test(name) ? "" : "a __Secure- or __Host- name",
        /;\s*httponly/i.test(cookie) ? "" : "HttpOnly",
        /;\s*secure/i.test(cookie) ? "" : "Secure",
        /;\s*samesite=(lax|strict)/i.test(cookie) ? "" : "SameSite=Lax or Strict",
      ].filter(Boolean);
      if (missing.length && !named.has(name)) flag("D1", "error", r.url, `sets cookie ${name} without ${missing.join(", ")}`);
      named.add(name);
    }
  };
  const private_ = (/** @type {Got} */ r, /** @type {string} */ what) => {
    if (!noStore(r)) flag("D10", "error", r.url, `${what} has no Cache-Control: no-store (got "${r.headers.get("cache-control") ?? ""}")`);
  };

  // The sign-in page: noindex and no-store (D10), the email field offers passkeys (A2), Turnstile on the form (B5).
  const pages = new Set();
  for (const path of ["/login", "/signin", "/sign-in"]) {
    const page = await follow(`${base}${path}`);
    if (page.status !== 200 || !/text\/html/.test(page.headers.get("content-type") ?? "") || pages.has(page.url)) continue;
    pages.add(page.url);
    found.push(`sign-in page ${new URL(page.url).pathname}`);
    private_(page, "the sign-in page");
    if (!noindex(page)) flag("D10", "error", page.url, "the sign-in page has no noindex (X-Robots-Tag or robots meta)");
    const email = [...page.body.matchAll(/<input\b[^>]*>/gi)].map(([tag]) => tag).find((tag) => /type=["']?email|name=["']?email/i.test(tag));
    const autocomplete = /autocomplete=["']([^"']*)["']/i.exec(email ?? "")?.[1].toLowerCase().split(/\s+/) ?? [];
    if (!email) flag("A2", "error", page.url, "the sign-in page has no email field in its HTML");
    else if (!autocomplete.includes("webauthn")) flag("A2", "error", page.url, `the email field's autocomplete is "${autocomplete.join(" ")}", without webauthn, so the browser offers no passkey`);
    else if (autocomplete[0] !== "username") flag("A2", "warning", page.url, `the email field's autocomplete is "${autocomplete.join(" ")}"; the bar is "username webauthn"`);
    const csp = page.headers.get("content-security-policy");
    if (!/0x4AAAAA[\w-]{8,}|cf-turnstile|challenges\.cloudflare\.com\/turnstile/.test(page.body)) flag("B5", "error", page.url, "the sign-in page carries no Turnstile site key or widget");
    else if (csp && !csp.includes("challenges.cloudflare.com")) flag("B5", "error", page.url, "the Content-Security-Policy does not allow https://challenges.cloudflare.com, so Turnstile cannot load");
  }

  // Better Auth: the passkey's relying party (A1), sign-out (D4), the origin check (D8), the link's confirm page (B7).
  const ok = await get(`${base}/api/auth/ok`);
  if (ok.status === 200 && json(ok)?.ok === true) {
    found.push("Better Auth");
    const options = await get(`${base}/api/auth/passkey/generate-authenticate-options`);
    const rpId = json(options)?.rpId;
    if (options.status !== 200 || typeof rpId !== "string") flag("A1", "error", options.url, `no passkey sign-in: answered ${options.status}`);
    else if (/\.(workers|pages)\.dev$/.test(rpId) || (rpId !== host && !host.endsWith(`.${rpId}`))) flag("A1", "error", options.url, `the passkey's rpId is ${rpId}, not ${host}: a passkey made here will not work on the site`);
    if (options.status === 200) private_(options, "the passkey challenge");
    cookies(options);

    const signOut = await get(`${base}/api/auth/sign-out`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: "{}" });
    if (!/"cookies"/.test(signOut.headers.get("clear-site-data") ?? "")) flag("D4", "error", signOut.url, `sign-out (${signOut.status}) sends no Clear-Site-Data with "cookies"`);
    private_(signOut, "sign-out");
    cookies(signOut);

    // Better Auth checks the Origin only on a request that carries a cookie (1.7.12 dist/api/middlewares/origin-check.mjs:101-108).
    const foreign = await get(`${base}/api/auth/sign-out`, { method: "POST", headers: { origin: "https://sign-in-check.invalid", cookie: "sitecheck=1", "content-type": "application/json" }, body: "{}" });
    if (foreign.status !== 403) flag("D8", "error", foreign.url, `a sign-out from another origin with a cookie answered ${foreign.status}, not 403`);

    // The confirm page stays a warning until every site has the route (site-runtime 0.36.0's confirmSignInLink). The
    // site's own path: the first that is not a 404, beside a sign-in page found first.
    const near = [...pages].map((page) => `${new URL(page).pathname.replace(/\/$/, "")}/confirm`);
    let confirm = /** @type {Got | undefined} */ (undefined);
    for (const path of new Set([...near, ...CONFIRM_PATHS])) {
      confirm = await get(`${base}${path}?token=sign-in-check-not-a-token&callbackURL=%2F`);
      if (confirm.status !== 404) break;
    }
    confirm = /** @type {Got} */ (confirm);
    const session = confirm.cookies.find((cookie) => /session/i.test(cookie.split("=")[0]) && keeps(cookie));
    if (session) flag("B7", "error", confirm.url, `a GET with a made-up token set ${session.split("=")[0].trim()}: only the page's POST may sign in`);
    else if (confirm.status === 405 || (confirm.status === 200 && /<form\b[^>]*method=["']?post/i.test(confirm.body))) {
      if (confirm.status === 200) {
        private_(confirm, "the confirm page");
        if (!noindex(confirm)) flag("D10", "error", confirm.url, "the confirm page has no noindex");
      }
    } else flag("B7", "warning", confirm.url, `no confirm page for the mailed link: answered ${confirm.status} (expected 200 with a POST form, or 405)`);
    cookies(confirm);
  }

  // Admin pages: Cloudflare Access (a redirect to *.cloudflareaccess.com) or the Worker's 401/403, never the page (G1).
  for (const path of new Set(["/admin", ...(elsewhere.admin ?? [])])) {
    const url = new URL(path, `${base}/`).href;
    const r = await get(url);
    const end = await follow(url); // past a same-origin hop, such as a trailing slash
    const declared = (elsewhere.admin ?? []).includes(path);
    if (declared && (end.status === 404 || end.status === 0 || end.status >= 500)) {
      flag("G1", "error", url, `a declared admin page answered ${end.status || end.error}, not a redirect to Access or a 401/403`);
      continue;
    }
    if (end.status === 404 || end.status === 0) continue;
    found.push(`admin ${url}`);
    const there = new URL(end.headers.get("location") ?? end.url, end.url);
    if (end.status === 200 && there.pathname.startsWith(new URL(url).pathname.replace(/\/$/, ""))) flag("G1", "error", end.url, "an admin page answered 200 to a request with no sign-in");
    else if (end.status === 200 || (end.status >= 300 && end.status < 400 && !/\.cloudflareaccess\.com$/.test(there.hostname))) flag("G1", "warning", url, `redirects to ${there.origin}${there.pathname}, not Cloudflare Access`);
    private_(r, "an admin response");
    // A redirect has no page to index, and Access's own redirect is Cloudflare's to set.
    if ((r.status < 300 || r.status >= 400) && !noindex(r)) flag("D10", "error", r.url, `an admin response (${r.status}) has no noindex`);
  }

  // MCP: discovery from the 401 (H1, RFC 9728), PKCE S256 only (H2) and CIMD (H4), per the MCP authorization spec 2025-11-25.
  for (const url of new Set([`${base}/mcp`, ...(elsewhere.mcp ?? [])])) {
    const declared = (elsewhere.mcp ?? []).includes(url);
    const r = await get(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
    if (r.status !== 401) {
      if (declared) flag("H1", "error", url, `the MCP server answered ${r.status || r.error} to a request with no token, not 401`);
      continue;
    }
    found.push(`MCP ${url}`);
    const challenge = r.headers.get("www-authenticate") ?? "";
    const metadataUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
    if (!/^Bearer\b/i.test(challenge) || !metadataUrl) flag("H1", "error", url, `the 401's WWW-Authenticate names no resource_metadata (got "${challenge}")`);
    if (/\berror=/.test(challenge)) flag("H1", "warning", url, "the 401 to a request with no token carries error=; RFC 6750 3.1 says to leave it out");
    const mcp = new URL(url);
    const prm = await get(metadataUrl ?? `${mcp.origin}/.well-known/oauth-protected-resource${mcp.pathname}`);
    const resource = json(prm);
    if (prm.status !== 200 || !resource) {
      flag("H1", "error", prm.url, `no protected resource metadata: answered ${prm.status}`);
      continue;
    }
    if (resource.resource !== url) flag("H1", "error", prm.url, `the metadata's resource is ${resource.resource}, not ${url}`);
    const issuer = resource.authorization_servers?.[0];
    if (typeof issuer !== "string") {
      flag("H1", "error", prm.url, "the metadata names no authorization_servers");
      continue;
    }
    const as = new URL(issuer);
    const path = as.pathname === "/" ? "" : as.pathname;
    let asr = await get(`${as.origin}/.well-known/oauth-authorization-server${path}`);
    if (asr.status !== 200) asr = await get(`${as.origin}/.well-known/openid-configuration${path}`);
    const meta = json(asr);
    if (asr.status !== 200 || !meta) {
      flag("H2", "error", asr.url, `no authorization server metadata: answered ${asr.status}`);
      continue;
    }
    const methods = meta.code_challenge_methods_supported;
    if (JSON.stringify(methods) !== '["S256"]') flag("H2", "error", asr.url, `code_challenge_methods_supported is ${JSON.stringify(methods)}, not ["S256"]`);
    if (meta.client_id_metadata_document_supported !== true) flag("H4", "error", asr.url, "client_id_metadata_document_supported is not true: no Client ID Metadata Documents");
    if (!meta.registration_endpoint) flag("H4", "warning", asr.url, "no registration_endpoint: clients without CIMD cannot register");
  }
  return { findings, found };
}
