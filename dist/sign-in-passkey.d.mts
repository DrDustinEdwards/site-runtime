/**
 * The user handle of the passkey that last signed in on this browser (`signInWithPasskey` keeps it with the account it
 * signed in), or null. Only `user`'s own: a browser can still hold another account's handle (a session that expired
 * never runs Clear-Site-Data), and a signal sent under that handle would tell the provider to hide that account's
 * passkeys. It is what the Signal API calls below take as `userId` when the page passes none. Kept in localStorage, so
 * Clear-Site-Data at sign-out removes it with the rest.
 * @param {string | null | undefined} user the signed-in account's id
 * @param {string} [rpId]
 * @returns {string | null}
 */
export function passkeyUserHandle(user: string | null | undefined, rpId?: string): string | null;
/**
 * Tells the provider which of this user's passkeys the site still accepts, so one deleted here leaves the provider's
 * list. `userId` is the passkey's user handle, base64url, as the sign-in gave it (`webauthn.response.response.userHandle`,
 * which signInWithPasskey keeps: the default): @better-auth/passkey 1.7.25 makes a new random handle for each passkey
 * and stores none, so a handle reaches only the passkey made with it. `credentialIds` are the account's credential ids
 * (`accountPasskeys` rows' `credentialId`). `user` is the signed-in account's id, which picks the kept handle when
 * `userId` is not passed. Resolves true when the browser took the signal; false with no handle.
 * @param {{ rpId?: string, userId?: string | null, user: string | null, credentialIds: string[] }} options
 */
export function signalAllAcceptedCredentials({ rpId, userId, user, credentialIds, }: {
    rpId?: string;
    userId?: string | null;
    user: string | null;
    credentialIds: string[];
}): Promise<boolean>;
/**
 * Tells the provider the name and display name to show on this user's passkey: after the email changes (`name` the new
 * address) and after the person renames themselves. `userId` and `user` as for signalAllAcceptedCredentials. Resolves
 * true when the browser took the signal; false with no handle.
 * @param {{ rpId?: string, userId?: string | null, user: string | null, name: string, displayName?: string }} options
 */
export function signalCurrentUserDetails({ rpId, userId, user, name, displayName, }: {
    rpId?: string;
    userId?: string | null;
    user: string | null;
    name: string;
    displayName?: string;
}): Promise<boolean>;
/**
 * Both of the above: after a passkey sign-in lands, and each time the account page's passkey list loads. Without a
 * handle (none passed, none kept for `user`) it does nothing; after a delete, signal the deleted one with
 * signalUnknownCredential.
 * @param {{ rpId?: string, userId?: string | null, user: string | null, credentialIds: string[], name?: string, displayName?: string }} options
 */
export function signalPasskeys({ rpId, userId, user, credentialIds, name, displayName, }: {
    rpId?: string;
    userId?: string | null;
    user: string | null;
    credentialIds: string[];
    name?: string;
    displayName?: string;
}): Promise<void>;
/**
 * Tells the provider the site no longer knows a passkey: after the person deletes it here, and after a sign-in that
 * failed with PASSKEY_NOT_FOUND (one deleted elsewhere; signInWithPasskey does that one). `credentialId` is base64url
 * (the passkey row's `credentialID`, or the failed sign-in's `webauthn.response.id`). Resolves true when the browser
 * took the signal.
 * @param {{ rpId: string, credentialId: string }} options
 */
export function signalUnknownCredential({ rpId, credentialId }: {
    rpId: string;
    credentialId: string;
}): Promise<boolean>;
/**
 * The passkey sign-in a page's button or autofill calls in place of `authClient.signIn.passkey`: the same call, with
 * `returnWebAuthnResponse` on. When the site does not know the passkey (PASSKEY_NOT_FOUND, deleted here from another
 * device) it tells the provider with signalUnknownCredential, so the browser stops offering it; when it signs in, it
 * keeps the passkey's user handle (`passkeyUserHandle`) for the other signals. Returns Better Auth's answer. `rpId`
 * defaults to the page's host, which is the relying party `./sign-in` sets.
 * @template {{ error?: object | null, data?: { user?: { id?: string } } | null, webauthn?: { response?: { id?: string, response?: { userHandle?: string | null } } } }} R
 * @param {{ signIn: { passkey(options?: Record<string, unknown>): Promise<R> } }} client
 * @param {Record<string, unknown> & { rpId?: string }} [options] the passkey sign-in's own options (`autoFill`, `fetchOptions`)
 * @returns {Promise<R>}
 */
export function signInWithPasskey<R extends {
    error?: object | null;
    data?: {
        user?: {
            id?: string;
        };
    } | null;
    webauthn?: {
        response?: {
            id?: string;
            response?: {
                userHandle?: string | null;
            };
        };
    };
}>(client: {
    signIn: {
        passkey(options?: Record<string, unknown>): Promise<R>;
    };
}, { rpId, ...options }?: Record<string, unknown> & {
    rpId?: string;
}): Promise<R>;
/**
 * Whether this device has a platform authenticator (Touch ID, Face ID, Windows Hello, an Android screen lock) to make
 * a passkey with, so the offer of a passkey after another sign-in is skipped where it could only fail. False where the
 * browser has no WebAuthn or will not say.
 * @returns {Promise<boolean>}
 */
export function canOfferPasskey(): Promise<boolean>;
/**
 * The sign-in screen's passkey: `signInWithPasskey`, then, when it signed in, tells the passkey provider which of the
 * account's passkeys the site still accepts and the address they belong to (`signalPasskeys`), so one removed elsewhere
 * leaves the browser's list. The signal never holds up the sign-in. Answers the client's error, or null when signed in.
 * @param {{ signIn: { passkey(options?: Record<string, unknown>): Promise<any> },
 *   passkey: { listUserPasskeys(): Promise<{ data?: { credentialID: string }[] | null }> },
 *   getSession(): Promise<{ data?: { user?: { id?: string, email?: string } } | null }> }} client
 * @param {{ autoFill?: boolean }} [options]
 * @returns {Promise<object | null>}
 */
export function passkeySignIn(client: {
    signIn: {
        passkey(options?: Record<string, unknown>): Promise<any>;
    };
    passkey: {
        listUserPasskeys(): Promise<{
            data?: {
                credentialID: string;
            }[] | null;
        }>;
    };
    getSession(): Promise<{
        data?: {
            user?: {
                id?: string;
                email?: string;
            };
        } | null;
    }>;
}, { autoFill }?: {
    autoFill?: boolean;
}): Promise<object | null>;
