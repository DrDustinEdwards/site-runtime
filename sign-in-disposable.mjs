import { APIError } from "better-auth/api";

import { DISPOSABLE_DOMAINS } from "./disposable-domains.mjs";
import { DISPOSABLE_EMAIL } from "./sign-in-words.mjs";

/**
 * True when the address is at a disposable (throwaway) domain or a subdomain of one, from the list in
 * `./disposable-domains.mjs` (update-disposable.mjs, from disposable-email-domains, CC0).
 * @param {string} email
 */
export function isDisposableEmail(email) {
  const at = email.lastIndexOf("@");
  if (at === -1) return false;
  const labels = email
    .slice(at + 1)
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .split(".");
  for (let i = 0; i < labels.length - 1; i++)
    if (DISPOSABLE_DOMAINS.has(labels.slice(i).join("."))) return true;
  return false;
}

/**
 * The before hook on a new user that refuses a disposable address, whichever way the account is made (link, code,
 * Google, Apple). An existing account keeps working. `signInOptions` puts it in `databaseHooks.user.create`.
 * @param {{ email: string }} user
 */
export async function refuseDisposable(user) {
  if (isDisposableEmail(user.email))
    throw new APIError("BAD_REQUEST", {
      code: DISPOSABLE_EMAIL,
      message: "Disposable email addresses are not allowed.",
    });
}
