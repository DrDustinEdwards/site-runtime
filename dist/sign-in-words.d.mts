/**
 * The words for a `?error=` code a sign-in page is sent back with (Better Auth's, from a refused Google or Apple
 * callback, a refused link, or the site's own limit), or null for none. `settings` names where the person joins Google
 * or Apple to the account ("Settings", "My account").
 * @param {string | null | undefined} code
 * @param {{ siteName: string, settings: string }} site
 */
export function signInErrorWords(code: string | null | undefined, { siteName, settings }: {
    siteName: string;
    settings: string;
}): string | null;
/**
 * The words for a passkey sign-in that did not sign in, from the error Better Auth's client returned, or null when the
 * person canceled the browser's prompt (choosing another way is not a failure).
 * @param {unknown} error
 */
export function passkeyErrorWords(error: unknown): "That passkey did not sign you in. Try again, or use another way." | "Too many tries. Wait a while, then try again, or use another way." | "Sign-in is busy right now. Wait a minute and try again, or use another way." | null;
/**
 * What the email-change page says (`emailLinkResult`'s `done` and `problem`): a title and a sentence each. `settings`
 * names the page where the address is changed ("Settings", "My account").
 * @param {{ siteName: string, settings: string }} site
 */
export function emailLinkWords({ siteName, settings }: {
    siteName: string;
    settings: string;
}): Readonly<{
    confirm: Readonly<{
        title: "Confirm your email change";
    }>;
    approved: Readonly<{
        title: "Change approved";
        text: `Now open the link ${string} sent to your new address to finish the change.`;
    }>;
    changed: Readonly<{
        title: "Email changed";
    }>;
    verified: Readonly<{
        title: "Email confirmed";
    }>;
    expired: Readonly<{
        title: "This link has expired";
        text: `Email change links work for 1 hour. Ask for the change again in ${string}.`;
    }>;
    done: Readonly<{
        title: "This change is already made";
        text: `The link has been used, so it no longer works. Your account email is shown in ${string}.`;
    }>;
    "other-account": Readonly<{
        title: "This link is for another account";
        text: `This browser is signed in to a different ${string} account. Sign out, then open the link again.`;
    }>;
    invalid: Readonly<{
        title: "This link no longer works";
        text: `It is not complete or not valid. Open it from the email again, or ask for the change again in ${string}.`;
    }>;
    failed: Readonly<{
        title: "The change did not finish";
        text: `Something went wrong on our side. Open the link from the email again, or ask for the change again in ${string}.`;
    }>;
    missing: Readonly<{
        title: "This link is not complete";
        text: "Part of the link is missing. Open it straight from the email.";
    }>;
}>;
/**
 * One row of a person's security history (`securityHistory`) in words: "Signed in with a passkey", "Google connected".
 * @param {{ kind: string, via: string | null }} entry
 */
export function securityHistoryWords({ kind, via }: {
    kind: string;
    via: string | null;
}): string;
/**
 * `text` is left out where the title says it all.
 * @typedef {Readonly<{ title: string; text?: string }>} Words
 */
/** How long each email-change link works: an hour, Better Auth's default, and the words the mails say. */
export const EMAIL_CHANGE_EXPIRES_IN_SECONDS: number;
export const EMAIL_CHANGE_EXPIRES_IN_WORDS: "1 hour";
/** The words every site's sign-in pages say, by answer. */
export const SIGN_IN_WORDS: Readonly<{
    noEmail: "Enter your email address.";
    noCode: "Enter the six-digit code from the email.";
    link: Readonly<{
        limited: "Too many sign-in requests. Wait a minute and try again.";
        "email-limited": "Too many sign-in requests for this address. Try again later.";
        "check-failed": "Complete the check, then send the link again.";
        unavailable: "Sign-in links can't be sent right now. Use a passkey, or try again later.";
        undeliverable: "Email to this address can't be delivered: an earlier email to it bounced or was marked as spam. Check the address for a typo, or use another way to sign in.";
        failed: "We could not send the link. Check the address and try again.";
    }>;
    code: Readonly<{
        wrong: "That code is not right. Check the six digits in the newest email: a code from an older email, or one already used, does not work.";
        expired: "That code has expired: a code works for 10 minutes. Send yourself a new one.";
        spent: "That code was tried three times, so it no longer works. Use the link in the same email, or send yourself a new one.";
        limited: "Too many tries. Wait a minute, or use the link in the email.";
        "email-limited": "Too many tries for this address. Try again later, or use the link in the email.";
        unavailable: "Codes can't be checked right now. Use the link in the email, or try again in a few minutes.";
        disposable: "Use a real email address. Disposable email addresses are not allowed.";
        "other-browser": "That code works only in the browser that asked for it. Type it there, or use the link in the email.";
        failed: "That sign-in did not complete. Try again, or use the link in the email.";
    }>;
    passkey: Readonly<{
        failed: "That passkey did not sign you in. Try again, or use another way.";
        limited: "Too many tries. Wait a while, then try again, or use another way.";
        unavailable: "Sign-in is busy right now. Wait a minute and try again, or use another way.";
    }>;
}>;
/** The words every site's account page says, by answer (`./sign-in-form` accountFormAction). */
export const ACCOUNT_WORDS: Readonly<{
    noEmail: "Enter an email address.";
    sameEmail: "That is already your email address.";
    disposable: "Use a real email address. Disposable email addresses are not allowed.";
    unverified: "Sign in with an email link first, then change your address.";
    emailFailed: "The email was not sent. Try again in a minute.";
    /** The current address the approval link goes to is on Email Service's suppression list. */
    emailUndeliverable: "Email to your current address can't be delivered (an earlier email to it bounced or was marked as spam), so the change can't be approved from it.";
    /** The current address the first email-change link went to, and the time both links last. */
    emailSent: (to: string) => string;
    stale: Readonly<{
        "change-email": "Changing your email needs a recent sign-in. Sign in again, then change it.";
        "sign-out-device": "Seeing and signing out your devices needs a recent sign-in. Sign in again first.";
        "delete-account": "Deleting your account needs a recent sign-in. Sign in again, then delete it.";
    }>;
    deviceFailed: "That device was not signed out. Try again.";
    noConfirm: "Tick the box to confirm, then delete your account.";
    deleteFailed: "The account was not deleted. Try again.";
    /** The browser's own changes on the account page (Better Auth's client), when one did not go through. */
    passkeyAddFailed: "The passkey was not saved. Try again.";
    passkeyRenameFailed: "The passkey was not renamed. Try again.";
    passkeyRemoveFailed: "The passkey was not removed. Try again.";
    linkFailed: (provider: string) => string;
    unlinkFailed: (provider: string) => string;
    othersFailed: "The other devices were not signed out. Try again.";
    offline: "That did not go through. Check your connection and try again.";
}>;
/**
 * `text` is left out where the title says it all.
 */
export type Words = Readonly<{
    title: string;
    text?: string;
}>;
export { DISPOSABLE_EMAIL, SIGN_IN_EXPIRES_IN_WORDS, SIGN_IN_LINK_WORDS, UNDELIVERABLE_EMAIL } from "./sign-in-link.mjs";
