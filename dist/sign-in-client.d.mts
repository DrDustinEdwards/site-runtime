export function signInClientPlugins(): [ReturnType<typeof magicLinkClient>, ReturnType<typeof emailOTPClient>, ReturnType<typeof passkeyClient>];
import { magicLinkClient } from "better-auth/client/plugins";
import { emailOTPClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";
export { canOfferPasskey, passkeySignIn, passkeyUserHandle, signInWithPasskey, signalAllAcceptedCredentials, signalCurrentUserDetails, signalPasskeys, signalUnknownCredential } from "./sign-in-passkey.mjs";
