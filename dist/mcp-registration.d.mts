/**
 * The redirect URIs a dynamically registered client may name, from a setting (DCR_REDIRECT_URIS) separated by commas
 * or spaces. Only https callbacks count: a code is never delivered in the clear.
 * @param {string | undefined} configured
 */
export function allowedRedirects(configured: string | undefined): string[];
/**
 * The tightened Dynamic Client Registration check, for the provider's clientRegistrationCallback. DCR is kept only
 * for the clients that still need it (Grok, Gemini), so a registration is allowed only when every redirect URI it
 * names is listed, character for character, in `configured` (close to an allowed one is how codes are stolen).
 * An empty or unset list refuses every registration.
 * @param {string | undefined} configured
 * @param {Record<string, unknown>} clientMetadata
 * @returns {string | null} null when the registration may proceed, else why it is refused, naming the URI
 */
export function registrationRefusal(configured: string | undefined, clientMetadata: Record<string, unknown>): string | null;
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
export function registrationLimited(request: Request, kv: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options?: {
        expirationTtl?: number;
    }): Promise<void>;
}, configured: string | undefined, now?: number): Promise<Response | null>;
/**
 * The registration callbacks the same for every user (Grok, Grok Bot, ChatGPT legacy, Gemini Enterprise), for a
 * server to allow beside its own DCR_REDIRECT_URIS, where a per-connector or per-user callback is listed.
 */
export const DCR_CALLBACKS: readonly string[];
