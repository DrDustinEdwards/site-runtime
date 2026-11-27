/**
 * True when the address is at a disposable (throwaway) domain or a subdomain of one, from the list in
 * `./disposable-domains.mjs` (update-disposable.mjs, from disposable-email-domains, CC0).
 * @param {string} email
 */
export function isDisposableEmail(email: string): boolean;
/**
 * The before hook on a new user that refuses a disposable address, whichever way the account is made (link, code,
 * Google, Apple). An existing account keeps working. `signInOptions` puts it in `databaseHooks.user.create`.
 * @param {{ email: string }} user
 */
export function refuseDisposable(user: {
    email: string;
}): Promise<void>;
