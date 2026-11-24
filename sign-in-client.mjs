/**
 * The browser half of `./sign-in`: the Better Auth client plugins every site's sign-in page uses, so the client and the
 * server always offer the same ways in, and the WebAuthn Signal API calls that keep the person's passkey provider in
 * step with the site (A6), and whether this device can make a passkey at all (A3).
 */
import { passkeyClient } from "@better-auth/passkey/client";
import { emailOTPClient, magicLinkClient } from "better-auth/client/plugins";

export {
  canOfferPasskey,
  passkeySignIn,
  passkeyUserHandle,
  signInWithPasskey,
  signalAllAcceptedCredentials,
  signalCurrentUserDetails,
  signalPasskeys,
  signalUnknownCredential,
} from "./sign-in-passkey.mjs";

/**
 * @returns {[ReturnType<typeof magicLinkClient>, ReturnType<typeof emailOTPClient>, ReturnType<typeof passkeyClient>]}
 */
export const signInClientPlugins = () => [magicLinkClient(), emailOTPClient(), passkeyClient()];

/**
 * For an action that needs a sign-in from the last few minutes (adding a passkey, unlinking Google or Apple): on Better
 * Auth's SESSION_NOT_FRESH, send the person to sign in again and back to this page. True when the error was that one and
 * the page is on its way.
 * @param {unknown} error what the Better Auth call returned
 * @param {(next: string) => string} signInHref the site's sign-in address for a page to come back to
 */
export function signInAgainIfStale(error, signInHref) {
  if (/** @type {{ code?: string } | null} */ (error)?.code !== "SESSION_NOT_FRESH") return false;
  window.location.assign(signInHref(location.pathname + location.search));
  return true;
}
