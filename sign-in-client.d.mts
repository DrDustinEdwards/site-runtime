/** The browser half of ./sign-in (sign-in-client.mjs). */
import type { magicLinkClient } from "better-auth/client/plugins";
import type { passkeyClient } from "@better-auth/passkey/client";

export function signInClientPlugins(): [ReturnType<typeof magicLinkClient>, ReturnType<typeof passkeyClient>];
