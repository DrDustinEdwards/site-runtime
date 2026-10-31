/** The browser half of ./sign-in (sign-in-client.mjs). */
import type { emailOTPClient, magicLinkClient } from "better-auth/client/plugins";
import type { passkeyClient } from "@better-auth/passkey/client";

export function signInClientPlugins(): [
  ReturnType<typeof magicLinkClient>,
  ReturnType<typeof emailOTPClient>,
  ReturnType<typeof passkeyClient>,
];

/** The user handle of the passkey that last signed in on this browser (kept by signInWithPasskey), or null. */
export function passkeyUserHandle(rpId?: string): string | null;

/**
 * The Signal API's signalAllAcceptedCredentials: the passkeys the site still accepts for this user handle. `rpId`
 * defaults to the page's host and `userId` to passkeyUserHandle(); false when there is no handle.
 */
export function signalAllAcceptedCredentials(options: { rpId?: string; userId?: string | null; credentialIds: string[] }): Promise<boolean>;

/** The Signal API's signalCurrentUserDetails: after an email change or a rename. Defaults as above. */
export function signalCurrentUserDetails(options: { rpId?: string; userId?: string | null; name: string; displayName?: string }): Promise<boolean>;

/**
 * Both of the above, after a passkey sign-in lands and when the passkey list loads. `userId` is the passkey's user
 * handle (base64url), by default the one signInWithPasskey kept; without one, nothing is signaled.
 */
export function signalPasskeys(options: {
  rpId?: string;
  userId?: string | null;
  credentialIds: string[];
  name?: string;
  displayName?: string;
}): Promise<void>;

/** The Signal API's signalUnknownCredential, for a passkey deleted here or a sign-in that failed with PASSKEY_NOT_FOUND. */
export function signalUnknownCredential(options: { rpId: string; credentialId: string }): Promise<boolean>;

/**
 * `authClient.signIn.passkey` with `returnWebAuthnResponse` on, which on PASSKEY_NOT_FOUND calls signalUnknownCredential
 * so the browser stops offering a passkey the site no longer has, and on success keeps the passkey's user handle
 * (passkeyUserHandle). `rpId` defaults to `location.hostname`.
 */
/** `R` is the client's own answer; the error is any object, since Better Auth's client error has no `code` in its type. */
export function signInWithPasskey<R extends { error?: object | null; webauthn?: { response?: { id?: string } } }>(
  client: { signIn: { passkey(options?: Record<string, unknown>): Promise<R> } },
  options?: Record<string, unknown> & { rpId?: string },
): Promise<R>;

/** Whether this device has a platform authenticator to make a passkey with; false where the browser cannot say. */
export function canOfferPasskey(): Promise<boolean>;
