/** Where a site sends its Anthropic calls: AI Gateway when configured, Anthropic directly when not (ai-gateway.mjs). */
export const ANTHROPIC_ORIGIN: "https://api.anthropic.com";

/** The AI Gateway request headers set here, spelled as Cloudflare documents them. */
export const AI_GATEWAY_HEADERS: Readonly<{
  auth: "cf-aig-authorization";
  bodyLog: "cf-aig-collect-log-payload";
  metadata: "cf-aig-metadata";
}>;

/**
 * The base URL for a site's Anthropic calls and the headers that go with them. With `AI_GATEWAY_BASE_URL` unset:
 * Anthropic's origin and no headers. Set: the gateway's `/anthropic` endpoint (anything else throws), body logging off,
 * `{"app": app}` as log metadata, and `AI_GATEWAY_TOKEN` as the gateway's bearer token when present.
 */
export function anthropicRoute(
  env: { AI_GATEWAY_BASE_URL?: string; AI_GATEWAY_TOKEN?: string },
  app: string,
): { baseURL: string; headers: Record<string, string>; gateway: boolean };
