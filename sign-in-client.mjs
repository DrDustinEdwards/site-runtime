/**
 * The browser half of `./sign-in`: the Better Auth client plugins every site's sign-in page uses, so the client and the
 * server always offer the same ways in, and the WebAuthn Signal API calls that keep the person's passkey provider in
 * step with the site (A6), and whether this device can make a passkey at all (A3).
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
 * list. `userId` is the passkey's user handle, base64url, as the sign-in gave it (`signIn.passkey({
 * returnWebAuthnResponse: true })`: `webauthn.response.response.userHandle`): @better-auth/passkey 1.7.12 makes a new
 * random handle for each passkey and stores none, so a handle reaches only the passkey made with it. `credentialIds`
 * are the account's `credentialID`s (listPasskeys). Resolves true when the browser took the signal.
 * @param {{ rpId: string, userId: string, credentialIds: string[] }} options
 */
export function signalAllAcceptedCredentials({ rpId, userId, credentialIds }) {
  return signal("signalAllAcceptedCredentials", { rpId, userId, allAcceptedCredentialIds: credentialIds });
}

/**
 * Tells the provider the name and display name to show on this user's passkey (after an email change, say). `userId`
 * as for signalAllAcceptedCredentials. Resolves true when the browser took the signal.
 * @param {{ rpId: string, userId: string, name: string, displayName?: string }} options
 */
export function signalCurrentUserDetails({ rpId, userId, name, displayName }) {
  return signal("signalCurrentUserDetails", { rpId, userId, name, displayName: displayName || name });
}

/**
 * Both of the above, after a passkey sign-in. Without `userId` it does nothing; after a delete, signal the deleted one
 * with signalUnknownCredential.
 * @param {{ rpId: string, userId?: string | null, credentialIds: string[], name?: string, displayName?: string }} options
 */
export async function signalPasskeys({ rpId, userId, credentialIds, name, displayName }) {
  if (!userId) return;
  await signalAllAcceptedCredentials({ rpId, userId, credentialIds });
  if (name) await signalCurrentUserDetails({ rpId, userId, name, displayName });
}

/**
 * Tells the provider the site no longer knows a passkey: after the person deletes it here, and after a sign-in that
 * failed with PASSKEY_NOT_FOUND (one deleted elsewhere; signInWithPasskey does that one). `credentialId` is base64url
 * (the passkey row's `credentialID`, or the failed sign-in's `webauthn.response.id`). Resolves true when the browser
 * took the signal.
 * @param {{ rpId: string, credentialId: string }} options
 */
export function signalUnknownCredential({ rpId, credentialId }) {
  return signal("signalUnknownCredential", { rpId, credentialId });
}

/**
 * The passkey sign-in a page's button or autofill calls in place of `authClient.signIn.passkey`: the same call, with
 * `returnWebAuthnResponse` on, and when the site does not know the passkey (PASSKEY_NOT_FOUND, deleted here from
 * another device) it tells the provider with signalUnknownCredential, so the browser stops offering it. Returns
 * Better Auth's answer. `rpId` defaults to the page's host, which is the relying party `./sign-in` sets.
 * @template {{ error?: object | null, webauthn?: { response?: { id?: string } } }} R
 * @param {{ signIn: { passkey(options?: Record<string, unknown>): Promise<R> } }} client
 * @param {Record<string, unknown> & { rpId?: string }} [options] the passkey sign-in's own options (`autoFill`, `fetchOptions`)
 * @returns {Promise<R>}
 */
export async function signInWithPasskey(client, { rpId, ...options } = {}) {
  const result = await client.signIn.passkey({ ...options, returnWebAuthnResponse: true });
  const credentialId = result?.webauthn?.response?.id;
  const host = rpId ?? /** @type {any} */ (globalThis).location?.hostname;
  const code = /** @type {{ code?: unknown } | null | undefined} */ (result?.error)?.code;
  if (code === "PASSKEY_NOT_FOUND" && credentialId && host) await signalUnknownCredential({ rpId: host, credentialId });
  return result;
}

/**
 * Whether this device has a platform authenticator (Touch ID, Face ID, Windows Hello, an Android screen lock) to make
 * a passkey with, so the offer of a passkey after another sign-in is skipped where it could only fail. False where the
 * browser has no WebAuthn or will not say.
 * @returns {Promise<boolean>}
 */
export async function canOfferPasskey() {
  const api = /** @type {any} */ (globalThis).PublicKeyCredential;
  if (typeof api?.isUserVerifyingPlatformAuthenticatorAvailable !== "function") return false;
  try {
    return (await api.isUserVerifyingPlatformAuthenticatorAvailable()) === true;
  } catch {
    return false;
  }
}
