/**
 * @typedef {(mail: { to: string, link: string, token: string, step: "current" | "new", newEmail?: string,
 *   expiresIn: string }) => Promise<void> | void} SendEmailChange
 */
/**
 * The account options every site spreads into betterAuth({ ... }) beside `signInOptions`: changing the email and
 * deleting the account, the same everywhere.
 * - EMAIL CHANGE TAKES TWO LINKS: the current address approves first, then the new address confirms itself, and only
 *   then does the email change, so a stolen session alone cannot move the account. Each link opens `confirmPath` (the
 *   site's page whose button posts, `confirmEmailLink`), never Better Auth's own GET, which a mail scanner would spend.
 *   Each lasts EMAIL_CHANGE_EXPIRES_IN_SECONDS. `sendEmailChange` mails both steps; `./sign-in`'s notice tells both
 *   addresses after. Nothing else mails a verification link (/send-verification-email is off).
 * - DELETION ONLY FROM THE SITE'S OWN ROUTE: Better Auth's /delete-user and its callback are off, so the account page's
 *   action calls auth.api.deleteUser after its fresh sign-in check, and `beforeDelete` (the site's hand-over or erase)
 *   runs first. Better Auth then removes the sessions, linked accounts and passkeys, then runs `afterDelete` (the site's
 *   clean-up outside its database, such as Foxhound revoking its Stripe grants), when the site has one.
 * @param {{ confirmPath: string, sendEmailChange: SendEmailChange, beforeDelete: (user: { id: string, email: string }) => Promise<void>, afterDelete?: (user: { id: string, email: string }) => Promise<void> }} site
 */
export function accountOptions({ confirmPath, sendEmailChange, beforeDelete, afterDelete }: {
    confirmPath: string;
    sendEmailChange: SendEmailChange;
    beforeDelete: (user: {
        id: string;
        email: string;
    }) => Promise<void>;
    afterDelete?: (user: {
        id: string;
        email: string;
    }) => Promise<void>;
}): {
    disabledPaths: string[];
    user: {
        changeEmail: {
            enabled: boolean;
            /** @param {{ user: { email: string }, newEmail: string, url: string, token: string }} data */
            sendChangeEmailConfirmation: ({ user, newEmail, url, token }: {
                user: {
                    email: string;
                };
                newEmail: string;
                url: string;
                token: string;
            }) => Promise<void>;
        };
        deleteUser: {
            enabled: boolean;
            beforeDelete: (user: {
                id: string;
                email: string;
            }) => Promise<void>;
            afterDelete: ((user: {
                id: string;
                email: string;
            }) => Promise<void>) | undefined;
        };
    };
    emailVerification: {
        expiresIn: number;
        /** @param {{ user: { email: string }, url: string, token: string }} data */
        sendVerificationEmail: ({ user, url, token }: {
            user: {
                email: string;
            };
            url: string;
            token: string;
        }) => Promise<void>;
    };
};
/**
 * @typedef {{ id: string, email: string, emailVerified?: boolean }} AccountUser
 * @typedef {{
 *   getSession(o: import("./sign-in-account.mjs").SessionLookup): Promise<{ session: { createdAt: Date | string, token: string }, user: AccountUser } | null>,
 *   listSessions(o: { headers: Headers }): Promise<import("./sign-in-account.mjs").SessionRow[]>,
 *   revokeSession(o: { headers: Headers, body: { token: string } }): Promise<unknown>,
 *   changeEmail(o: { headers: Headers, body: { newEmail: string } }): Promise<unknown>,
 *   deleteUser(o: { headers: Headers, body: Record<string, never>, asResponse: true }): Promise<Response>,
 * }} AccountApi
 */
/**
 * The account page's posts, the same on every site, for Capsomer's account settings: `intent=change-email` (field
 * `newEmail`), `intent=sign-out-device` (field `session`, a session id, so no token reaches the page) and
 * `intent=delete-account` (field `confirm`, the box the person ticked). Any other intent answers null, for the site's own
 * posts (a profile, Foxhound's Cancel account).
 * - EMAIL CHANGE: refused for a malformed, unchanged or disposable address and for an account whose address was never
 *   confirmed (Better Auth would then mail the new address alone); otherwise Better Auth's two-link change
 *   (`accountOptions`), whose answer is the same whether or not the new address is taken, so the page says nothing about
 *   it either.
 * - DELETE: needs a recent sign-in and the ticked box. `beforeDelete(user, form)` is the site's own step first (Foxing's
 *   club hand-over, read from the form); a string it returns is the refusal shown. Then Better Auth deletes the person
 *   (its own `beforeDelete` in `accountOptions` runs, and may refuse with an APIError whose message is shown), and the
 *   answer is `deletedLanding` with the cleared cookies.
 * - STALE: each of the three needs a sign-in from the last FRESH_SECONDS; without one the state has `stale: true` and
 *   the page offers "Sign in again".
 * @param {{ api: AccountApi }} auth
 * @param {Request} request
 * @param {FormData} form
 * @param {{ deletedLanding: string, beforeDelete?: (user: AccountUser, form: FormData) => Promise<string | null | undefined> }} site
 * @returns {Promise<{ location: string, headers: Headers } | { state: AccountFormState, status: number } | null>}
 */
export function accountFormAction(auth: {
    api: AccountApi;
}, request: Request, form: FormData, site: {
    deletedLanding: string;
    beforeDelete?: (user: AccountUser, form: FormData) => Promise<string | null | undefined>;
}): Promise<{
    location: string;
    headers: Headers;
} | {
    state: AccountFormState;
    status: number;
} | null>;
/** The account page's posts `accountFormAction` answers, by their `intent` field. */
export const ACCOUNT_INTENTS: readonly ["change-email", "sign-out-device", "delete-account"];
export type SendEmailChange = (mail: {
    to: string;
    link: string;
    token: string;
    step: "current" | "new";
    newEmail?: string;
    expiresIn: string;
}) => Promise<void> | void;
export type AccountUser = {
    id: string;
    email: string;
    emailVerified?: boolean;
};
export type AccountApi = {
    getSession(o: import("./sign-in-account.mjs").SessionLookup): Promise<{
        session: {
            createdAt: Date | string;
            token: string;
        };
        user: AccountUser;
    } | null>;
    listSessions(o: {
        headers: Headers;
    }): Promise<import("./sign-in-account.mjs").SessionRow[]>;
    revokeSession(o: {
        headers: Headers;
        body: {
            token: string;
        };
    }): Promise<unknown>;
    changeEmail(o: {
        headers: Headers;
        body: {
            newEmail: string;
        };
    }): Promise<unknown>;
    deleteUser(o: {
        headers: Headers;
        body: Record<string, never>;
        asResponse: true;
    }): Promise<Response>;
};
import type { AccountFormState } from "./sign-in-form.mjs";
