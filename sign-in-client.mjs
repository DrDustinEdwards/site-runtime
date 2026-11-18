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

export const signInClientPlugins = () => [magicLinkClient(), emailOTPClient(), passkeyClient()];
