/**
 * For an action that needs a sign-in from the last few minutes (adding a passkey, unlinking Google or Apple): on Better
 * Auth's SESSION_NOT_FRESH, send the person to sign in again and back to this page. True when the error was that one and
 * the page is on its way.
 * @param {unknown} error what the Better Auth call returned
 * @param {(next: string) => string} signInHref the site's sign-in address for a page to come back to
 */
export function signInAgainIfStale(error: unknown, signInHref: (next: string) => string): boolean;
export function signInClientPlugins(): [ReturnType<typeof magicLinkClient>, ReturnType<typeof emailOTPClient>, ReturnType<typeof passkeyClient>];
import { magicLinkClient } from "better-auth/client/plugins";
import { emailOTPClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";
export { canOfferPasskey, passkeySignIn, passkeyUserHandle, signInWithPasskey, signalAllAcceptedCredentials, signalCurrentUserDetails, signalPasskeys, signalUnknownCredential } from "./sign-in-passkey.mjs";
