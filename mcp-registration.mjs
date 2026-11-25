import { readCapped } from "./body.mjs";
import { ipKey } from "./rate-limit/limit.mjs";

/**
 * The registration callbacks the same for every user (Grok, Grok Bot, ChatGPT legacy, Gemini Enterprise), for a
 * server to allow beside its own DCR_REDIRECT_URIS, where a per-connector or per-user callback is listed.
 */
export const DCR_CALLBACKS = /* @__PURE__ */ Object.freeze([
  "https://grok.com/connectors/oauth/callback",
  "https://grok.com/connectors-oauth-exchange-code/",
  "https://www.cursor.com/agents/mcp/oauth/callback",
  "https://chatgpt.com/connector_platform_oauth_redirect",
  "https://vertexaisearch.cloud.google.com/oauth-redirect",
]);

/**
 * The redirect URIs a dynamically registered client may name, from a setting (DCR_REDIRECT_URIS) separated by commas
 * or spaces. Only https callbacks count: a code is never delivered in the clear.
 * @param {string | undefined} configured
 */
export function allowedRedirects(configured) {
  return (configured ?? "").split(/[\s,]+/).filter((uri) => uri.startsWith("https://"));
}

/**
 * The tightened Dynamic Client Registration check, for the provider's clientRegistrationCallback. DCR is kept only
 * for the clients that still need it (Grok, Gemini), so a registration is allowed only when every redirect URI it
 * names is listed, character for character, in `configured` (close to an allowed one is how codes are stolen).
 * An empty or unset list refuses every registration.
 * @param {string | undefined} configured
 * @param {Record<string, unknown>} clientMetadata
 * @returns {string | null} null when the registration may proceed, else why it is refused, naming the URI
 */
export function registrationRefusal(configured, clientMetadata) {
  const allowed = allowedRedirects(configured);
  if (allowed.length === 0)
    return "Dynamic client registration is closed on this server: no redirect URI is allowlisted.";
  const asked = clientMetadata.redirect_uris;
  if (!Array.isArray(asked) || asked.length === 0)
    return "A registration must name at least one redirect URI.";
  if (asked.length > 5) return "A registration may name at most five redirect URIs.";
  for (const uri of asked) {
    if (typeof uri !== "string" || !allowed.includes(uri)) {
      // Name everything sent, so the log shows whether one unlisted callback sank a request that named a listed one.
      const sent = JSON.stringify(asked.map((one) => String(one).slice(0, 200)));
      const method = JSON.stringify(
        String(clientMetadata.token_endpoint_auth_method ?? "none given").slice(0, 40),
      );
      return `The redirect URI ${JSON.stringify(uri)} is not allowlisted on this server. The request named ${asked.length} redirect URI(s), ${sent}, with token_endpoint_auth_method ${method}.`;
    }
  }
  return null;
}

/**
 * Counts one POST /register and answers the 429 to send, or null: five an hour from one address, counting every
 * registration, and thirty a day from everyone, counting only one `configured` would allow (registrationRefusal), so
 * junk from a few addresses cannot close registration for the day. A
 * refused one is still answered 400 by the provider's callback. In KV, so a burst can pass a few over. Call it
 * before the provider sees the request.
 * @param {Request} request
 * @param {{ get(key: string): Promise<string | null>, put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> }} kv
 * @param {string | undefined} configured the allowlist the provider's callback checks
 * @param {number} [now]
 * @returns {Promise<Response | null>}
 */
export async function registrationLimited(request, kv, configured, now = Date.now()) {
  // One address is an IPv4 address or an IPv6 /64 (ipKey), so a host cannot register from each address it holds.
  const address = ipKey("dcr-rate:addr", request).key;
  // Capped before the counters are read, so a huge body costs one small read, not a parse.
  const metadata = await readCapped(request.clone(), 8 * 1024)
    .then((text) => (text ? JSON.parse(text) : null))
    .catch(() => null);
  const allowed =
    metadata !== null &&
    typeof metadata === "object" &&
    registrationRefusal(configured, /** @type {Record<string, unknown>} */ (metadata)) === null;
  const keys = [
    { key: `${address}:${Math.floor(now / 3_600_000)}`, limit: 5, ttl: 3_700 },
    ...(allowed
      ? [{ key: `dcr-rate:all:${Math.floor(now / 86_400_000)}`, limit: 30, ttl: 86_500 }]
      : []),
  ];
  const counts = await Promise.all(keys.map(async (k) => Number((await kv.get(k.key)) ?? 0)));
  if (keys.some((k, i) => counts[i] >= k.limit)) {
    console.warn(JSON.stringify({ door: "registration-limited", address }));
    return new Response(
      JSON.stringify({
        error: "temporarily_unavailable",
        error_description: "Too many registrations. Try again later.",
      }),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
          "retry-after": "3600",
        },
      },
    );
  }
  await Promise.all(
    keys.map((k, i) => kv.put(k.key, String(counts[i] + 1), { expirationTtl: k.ttl })),
  );
  return null;
}
