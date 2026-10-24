/**
 * Where a site sends its Anthropic calls: Cloudflare AI Gateway when the site is configured for it, Anthropic directly
 * when it is not. One decision for every site, so the gateway's URL check, its sign-in header and the body-logging
 * switch are made once and cannot drift apart per site.
 *
 * - OPT IN, BY ENVIRONMENT. With `AI_GATEWAY_BASE_URL` unset the answer is Anthropic's own origin and no extra header,
 *   so a site behaves exactly as before until its gateway exists. Set, it is the gateway's Anthropic endpoint,
 *   `https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/anthropic` (developers.cloudflare.com/ai-gateway/
 *   usage/providers/anthropic/), or a custom domain's `/anthropic`. Anything not https or not ending in `/anthropic`
 *   throws: a gateway URL that is set but wrong would otherwise send every call to the wrong place.
 * - THE SITE'S OWN KEY STAYS THE CREDENTIAL. The caller still sends its Anthropic key (`x-api-key`) and the gateway
 *   passes it on, so no key is stored in the gateway and billing stays with Anthropic.
 * - AUTHENTICATED GATEWAY. A gateway with authentication on (the default for a new one) refuses a request without
 *   `cf-aig-authorization: Bearer <token>`; `AI_GATEWAY_TOKEN` is that token. It is optional so a gateway with
 *   authentication off also works.
 * - BODIES ARE NOT LOGGED. AI Gateway stores request and response bodies by default; the sites' prompts carry readers'
 *   and customers' data. `cf-aig-collect-log-payload: false` keeps the metadata log (model, tokens, cost, status,
 *   duration), which is what the gateway is for, and drops the bodies (AI Gateway changelog, 2026-03-17). It is a header
 *   in code rather than a dashboard toggle so it cannot drift unseen.
 * - ONE GATEWAY, SPLIT BY SITE. `cf-aig-metadata: {"app": ...}` tags each log entry with the site, so one gateway's logs
 *   and analytics still separate the sites.
 */

export const ANTHROPIC_ORIGIN = "https://api.anthropic.com";

/** The AI Gateway request headers this module sets, spelled as Cloudflare documents them. */
export const AI_GATEWAY_HEADERS = Object.freeze({
  auth: "cf-aig-authorization",
  bodyLog: "cf-aig-collect-log-payload",
  metadata: "cf-aig-metadata",
});

/**
 * The base URL for a site's Anthropic calls and the headers that go with them. Pass `baseURL` and `headers` to the
 * Anthropic SDK as `baseURL` and `defaultHeaders`, or fetch `${baseURL}/v1/messages` with `headers` added.
 * @param {{ AI_GATEWAY_BASE_URL?: string; AI_GATEWAY_TOKEN?: string }} env
 * @param {string} app the site's name, as the gateway's logs should show it
 * @returns {{ baseURL: string; headers: Record<string, string>; gateway: boolean }}
 */
export function anthropicRoute(env, app) {
  const url = env.AI_GATEWAY_BASE_URL?.trim().replace(/\/+$/, "") ?? "";
  if (!url) return { baseURL: ANTHROPIC_ORIGIN, headers: {}, gateway: false };
  if (!/^https:\/\/[^/]+\/.*anthropic$/.test(url)) {
    throw new Error(
      "AI_GATEWAY_BASE_URL must be the gateway's Anthropic endpoint, https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/anthropic",
    );
  }
  /** @type {Record<string, string>} */
  const headers = {
    [AI_GATEWAY_HEADERS.bodyLog]: "false",
    [AI_GATEWAY_HEADERS.metadata]: JSON.stringify({ app }),
  };
  const token = env.AI_GATEWAY_TOKEN?.trim();
  if (token) headers[AI_GATEWAY_HEADERS.auth] = `Bearer ${token}`;
  return { baseURL: url, headers, gateway: true };
}
