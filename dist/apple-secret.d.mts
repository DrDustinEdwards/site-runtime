/**
 * @param {{ APPLE_CLIENT_ID?: string, APPLE_TEAM_ID?: string, APPLE_KEY_ID?: string, APPLE_PRIVATE_KEY?: string }} env
 *   APPLE_CLIENT_ID is the Services ID, APPLE_PRIVATE_KEY the .p8 file's text.
 * @param {number} [now] seconds since the epoch
 * @returns {Promise<string | null>}
 */
export function appleClientSecret(env: {
    APPLE_CLIENT_ID?: string;
    APPLE_TEAM_ID?: string;
    APPLE_KEY_ID?: string;
    APPLE_PRIVATE_KEY?: string;
}, now?: number): Promise<string | null>;
