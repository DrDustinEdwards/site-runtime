/**
 * The browser half of `./sign-in`: the Better Auth client plugins every site's sign-in page uses, so the client and the
 * server always offer the same ways in.
 */
import { passkeyClient } from "@better-auth/passkey/client";
import { magicLinkClient } from "better-auth/client/plugins";

export const signInClientPlugins = () => [magicLinkClient(), passkeyClient()];
