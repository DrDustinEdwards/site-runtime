/**
 * The browser half of `./sign-in`: the Better Auth client plugins every site's sign-in page uses, so the client and the
 * server always offer the same ways in, and the WebAuthn Signal API calls that keep the person's passkey provider in
 * step with the site (A6).
 */
import { passkeyClient } from "@better-auth/passkey/client";
import { emailOTPClient, magicLinkClient } from "better-auth/client/plugins";

export const signInClientPlugins = () => [magicLinkClient(), emailOTPClient(), passkeyClient()];

/**
 * The Signal API (WebAuthn Level 3, `PublicKeyCredential.signal*`; Chrome 132, Safari 26) when the browser has it, else
 * nothing. A signal is a hint the provider may act on, so a refusal is swallowed: it never blocks the page.
 * @param {"signalAllAcceptedCredentials" | "signalCurrentUserDetails" | "signalUnknownCredential"} method
 * @param {Record<string, unknown>} options
 */
async function signal(method, options) {
  const api = /** @type {Record<string, unknown> | undefined} */ (/** @type {any} */ (globalThis).PublicKeyCredential);
  const call = api?.[method];
  if (typeof call !== "function") return false;
  try {
    await call.call(api, options);
    return true;
  } catch {
    return false;
  }
}

/**
 * Tells the provider which of this user's passkeys the site still accepts, so one deleted here leaves the provider's
 * list, and the name and display name to show on them. `userId` is the passkey's user handle, base64url, as the sign-in
 * gave it (`signIn.passkey({ returnWebAuthnResponse: true })`: `webauthn.response.response.userHandle`):
 * @better-auth/passkey 1.7.12 makes a new random handle for each passkey and stores none, so a handle reaches only the
 * passkey made with it. `credentialIds` are the account's `credentialID`s (listPasskeys). Without `userId` it does
 * nothing; after a delete, signal the deleted one with signalUnknownCredential.
 * @param {{ rpId: string, userId?: string | null, credentialIds: string[], name?: string, displayName?: string }} options
 */
export async function signalPasskeys({ rpId, userId, credentialIds, name, displayName }) {
  if (!userId) return;
  await signal("signalAllAcceptedCredentials", { rpId, userId, allAcceptedCredentialIds: credentialIds });
  if (name) await signal("signalCurrentUserDetails", { rpId, userId, name, displayName: displayName || name });
}

/**
 * Tells the provider the site no longer knows a passkey: after the person deletes it here, and after a sign-in that
 * failed with PASSKEY_NOT_FOUND (one deleted elsewhere). `credentialId` is base64url (the passkey row's `credentialID`,
 * or the failed sign-in's `webauthn.response.id`). Resolves true when the browser took the signal.
 * @param {{ rpId: string, credentialId: string }} options
 */
export function signalUnknownCredential({ rpId, credentialId }) {
  return signal("signalUnknownCredential", { rpId, credentialId });
}
