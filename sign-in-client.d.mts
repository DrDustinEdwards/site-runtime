/** The browser half of ./sign-in (sign-in-client.mjs). */
import type { emailOTPClient, magicLinkClient } from "better-auth/client/plugins";
import type { passkeyClient } from "@better-auth/passkey/client";

export function signInClientPlugins(): [
  ReturnType<typeof magicLinkClient>,
  ReturnType<typeof emailOTPClient>,
  ReturnType<typeof passkeyClient>,
];

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
