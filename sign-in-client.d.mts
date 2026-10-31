/** The browser half of ./sign-in (sign-in-client.mjs). */
import type { emailOTPClient, magicLinkClient } from "better-auth/client/plugins";
import type { passkeyClient } from "@better-auth/passkey/client";

export function signInClientPlugins(): [
  ReturnType<typeof magicLinkClient>,
  ReturnType<typeof emailOTPClient>,
  ReturnType<typeof passkeyClient>,
];

/** The Signal API's signalAllAcceptedCredentials: the passkeys the site still accepts for this user handle. */
export function signalAllAcceptedCredentials(options: { rpId: string; userId: string; credentialIds: string[] }): Promise<boolean>;

/** The Signal API's signalCurrentUserDetails: the name and display name the provider shows on the passkey. */
export function signalCurrentUserDetails(options: { rpId: string; userId: string; name: string; displayName?: string }): Promise<boolean>;

/**
 * Both of the above when the browser has them. `userId` is the passkey's user handle (base64url) from the sign-in's
 * WebAuthn response; without it, nothing is signaled.
 */
export function signalPasskeys(options: {
  rpId: string;
  userId?: string | null;
  credentialIds: string[];
  name?: string;
  displayName?: string;
}): Promise<void>;

/** The Signal API's signalUnknownCredential, for a passkey deleted here or a sign-in that failed with PASSKEY_NOT_FOUND. */
export function signalUnknownCredential(options: { rpId: string; credentialId: string }): Promise<boolean>;

/**
 * `authClient.signIn.passkey` with `returnWebAuthnResponse` on, which on PASSKEY_NOT_FOUND calls signalUnknownCredential
 * so the browser stops offering a passkey the site no longer has. `rpId` defaults to `location.hostname`.
 */
/** `R` is the client's own answer; the error is any object, since Better Auth's client error has no `code` in its type. */
export function signInWithPasskey<R extends { error?: object | null; webauthn?: { response?: { id?: string } } }>(
  client: { signIn: { passkey(options?: Record<string, unknown>): Promise<R> } },
  options?: Record<string, unknown> & { rpId?: string },
): Promise<R>;
