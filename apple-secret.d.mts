/** Sign in with Apple's client secret (apple-secret.mjs). */
/** A 30-day ES256 JWT signed with the site's Apple key, or null while any of the four settings is missing. */
export function appleClientSecret(
  env: { APPLE_CLIENT_ID?: string; APPLE_TEAM_ID?: string; APPLE_KEY_ID?: string; APPLE_PRIVATE_KEY?: string },
  now?: number,
): Promise<string | null>;
