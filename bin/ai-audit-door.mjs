/** A4 and A8: the authorization server's metadata and what /authorize does with garbage. */

import { jsonOf } from "./ai-audit-wire.mjs";

/** @import { Ctx } from "./ai-audit-wire.mjs" */

/**
 * @param {Ctx} ctx
 * @param {string} origin
 * @param {{ url: string, prm: Record<string, any> }} first the first protected-resource document
 * @returns {Promise<{ issuer: string, asUrl: string }>}
 */
export async function auditAuthServer({ get, report }, origin, { url, prm }) {
  const issuer = String(
    Array.isArray(prm.authorization_servers) && prm.authorization_servers[0]
      ? prm.authorization_servers[0]
      : origin,
  );
  /** @type {Record<string, any> | null} */
  let as = null;
  let asUrl = "";
  try {
    const parsed = new URL(issuer);
    const path = parsed.pathname.replace(/\/$/, "");
    asUrl = `${parsed.origin}/.well-known/oauth-authorization-server${path}`;
  } catch {
    report("error", "A4", url, `authorization server ${issuer} is not a URL`);
  }
  if (asUrl) {
    const meta = await get(asUrl, { headers: { accept: "application/json" } });
    asUrl = meta.url;
    if (!meta.res) report("error", "A4", meta.url, meta.why);
    else if (!meta.res.ok) report("error", "A4", meta.url, `answered ${meta.res.status}`);
    else if (!(as = await jsonOf(meta.res)))
      report("error", "A4", meta.url, "is not a JSON object");
  }
  if (as) {
    if (as.issuer !== issuer)
      report("error", "A4", asUrl, `issuer ${JSON.stringify(as.issuer)} is not exactly ${issuer}`);
    const methods = Array.isArray(as.code_challenge_methods_supported)
      ? as.code_challenge_methods_supported
      : [];
    if (!methods.includes("S256"))
      report("error", "A4", asUrl, "code_challenge_methods_supported does not list S256");
    if (methods.includes("plain"))
      report("error", "A4", asUrl, "code_challenge_methods_supported lists plain");
    if (as.client_id_metadata_document_supported !== true)
      report("error", "A4", asUrl, "client_id_metadata_document_supported is not true");
    if (as.authorization_response_iss_parameter_supported !== true)
      report("error", "A4", asUrl, "authorization_response_iss_parameter_supported is not true");
  }

  // A8: whatever /authorize answers to garbage, it is never stored.
  const authorize = new URL(
    typeof as?.authorization_endpoint === "string"
      ? as.authorization_endpoint
      : `${origin}/authorize`,
  );
  for (const [k, v] of Object.entries({
    response_type: "code",
    client_id: "https://evil.example/client.json",
    redirect_uri: "https://evil.example/cb",
    state: "x",
    code_challenge: "x",
    code_challenge_method: "S256",
  })) {
    authorize.searchParams.set(k, v);
  }
  const consent = await get(authorize.href, { headers: { accept: "text/html" } });
  if (!consent.res) report("error", "A8", consent.url, consent.why);
  else if (!/no-store/i.test(consent.res.headers.get("cache-control") ?? "")) {
    report(
      "error",
      "A8",
      consent.url,
      `${consent.res.status} with Cache-Control ${JSON.stringify(consent.res.headers.get("cache-control") ?? "(none)")}, not no-store`,
    );
  }
  await consent.res?.body?.cancel();
  return { issuer, asUrl };
}
