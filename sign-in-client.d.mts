/** The browser half of ./sign-in (sign-in-client.mjs). */
import type { emailOTPClient, magicLinkClient } from "better-auth/client/plugins";
import type { passkeyClient } from "@better-auth/passkey/client";

export function signInClientPlugins(): [
  ReturnType<typeof magicLinkClient>,
  ReturnType<typeof emailOTPClient>,
  ReturnType<typeof passkeyClient>,
];

/**
 * The Signal API's signalAllAcceptedCredentials and signalCurrentUserDetails when the browser has them. `userId` is the
 * passkey's user handle (base64url) from the sign-in's WebAuthn response; without it, nothing is signaled.
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
