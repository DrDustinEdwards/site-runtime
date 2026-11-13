/**
 * The words every site's sign-in pages say, one set for the network, with no dependency so the browser can read them
 * too: `./sign-in-form` answers with them on the server, and Capsomer's sign-in screen shows them (and the passkey's,
 * which only the browser knows).
 */
import { DISPOSABLE_EMAIL, SIGN_IN_EXPIRES_IN_WORDS } from "./sign-in-link.mjs";

/** How long each email-change link works: an hour, Better Auth's default, and the words the mails say. */
export const EMAIL_CHANGE_EXPIRES_IN_SECONDS = 60 * 60;
export const EMAIL_CHANGE_EXPIRES_IN_WORDS = "1 hour";

/** The refusal of a disposable address, on the sign-in page and the account page alike. */
const DISPOSABLE_WORDS = "Use a real email address. Disposable email addresses are not allowed.";

/** The words every site's sign-in pages say, by answer. */
export const SIGN_IN_WORDS = Object.freeze({
  noEmail: "Enter your email address.",
  noCode: "Enter the six-digit code from the email.",
  link: Object.freeze({
    limited: "Too many sign-in requests. Wait a minute and try again.",
    "email-limited": "Too many sign-in requests for this address. Try again later.",
    "check-failed": "Complete the check, then send the link again.",
    unavailable: "Sign-in links can't be sent right now. Use a passkey, or try again later.",
    failed: "We could not send the link. Check the address and try again.",
  }),
  code: Object.freeze({
    wrong:
      "That code is not right. Check the six digits in the newest email: a code from an older email, or one already used, does not work.",
    expired: `That code has expired: a code works for ${SIGN_IN_EXPIRES_IN_WORDS}. Send yourself a new one.`,
    spent:
      "That code was tried three times, so it no longer works. Use the link in the same email, or send yourself a new one.",
    limited: "Too many tries. Wait a minute, or use the link in the email.",
    "email-limited":
      "Too many tries for this address. Try again later, or use the link in the email.",
    unavailable:
      "Codes can't be checked right now. Use the link in the email, or try again in a few minutes.",
    disposable: DISPOSABLE_WORDS,
    failed: "That sign-in did not complete. Try again, or use the link in the email.",
  }),
  passkey: Object.freeze({
    failed: "That passkey did not sign you in. Try again, or use another way.",
    limited: "Too many tries. Wait a while, then try again, or use another way.",
    unavailable: "Sign-in is busy right now. Wait a minute and try again, or use another way.",
  }),
});

/** The words every site's account page says, by answer (`./sign-in-form` accountFormAction). */
export const ACCOUNT_WORDS = Object.freeze({
  noEmail: "Enter an email address.",
  sameEmail: "That is already your email address.",
  disposable: DISPOSABLE_WORDS,
  unverified: "Sign in with an email link first, then change your address.",
  emailFailed: "The email was not sent. Try again in a minute.",
  /** The current address the first email-change link went to, and the time both links last. */
  emailSent: (/** @type {string} */ to) =>
    `We sent a link to ${to}. Open it within ${EMAIL_CHANGE_EXPIRES_IN_WORDS} to approve the change; we then send one to the new address to confirm it.`,
  stale: Object.freeze({
    "change-email": "Changing your email needs a recent sign-in. Sign in again, then change it.",
    "sign-out-device":
      "Seeing and signing out your devices needs a recent sign-in. Sign in again first.",
    "delete-account":
      "Deleting your account needs a recent sign-in. Sign in again, then delete it.",
  }),
  deviceFailed: "That device was not signed out. Try again.",
  noConfirm: "Tick the box to confirm, then delete your account.",
  deleteFailed: "The account was not deleted. Try again.",
  /** The browser's own changes on the account page (Better Auth's client), when one did not go through. */
  passkeyAddFailed: "The passkey was not saved. Try again.",
  passkeyRenameFailed: "The passkey was not renamed. Try again.",
  passkeyRemoveFailed: "The passkey was not removed. Try again.",
  linkFailed: (/** @type {string} */ provider) => `${provider} was not connected. Try again.`,
  unlinkFailed: (/** @type {string} */ provider) => `${provider} was not disconnected. Try again.`,
  othersFailed: "The other devices were not signed out. Try again.",
  offline: "That did not go through. Check your connection and try again.",
});

/**
 * The words for a `?error=` code a sign-in page is sent back with (Better Auth's, from a refused Google or Apple
 * callback, a refused link, or the site's own limit), or null for none. `settings` names where the person joins Google
 * or Apple to the account ("Settings", "My account").
 * @param {string | null | undefined} code
 * @param {{ siteName: string, settings: string }} site
 */
export function signInErrorWords(code, { siteName, settings }) {
  if (!code) return null;
  if (code === DISPOSABLE_EMAIL) return SIGN_IN_WORDS.code.disposable;
  // Accounts are joined only by a signed-in person (`./sign-in`), never by a matching email at sign-in, so this one has
  // a way forward.
  if (code === "account_not_linked")
    return `That email already has a ${siteName} account. Sign in with an email link, then connect Google or Apple in ${settings}.`;
  if (code === "rate_limited" || code === "too_many_requests") return SIGN_IN_WORDS.link.limited;
  return "That sign-in did not complete. Try again, or use another way.";
}

export { DISPOSABLE_EMAIL, SIGN_IN_EXPIRES_IN_WORDS, SIGN_IN_LINK_WORDS } from "./sign-in-link.mjs";

/**
 * The words for a passkey sign-in that did not sign in, from the error Better Auth's client returned, or null when the
 * person canceled the browser's prompt (choosing another way is not a failure).
 * @param {unknown} error
 */
export function passkeyErrorWords(error) {
  const code = /** @type {{ code?: unknown } | null} */ (error)?.code;
  if (code === "AUTH_CANCELLED") return null; // codespell:ignore -- Better Auth's error code
  if (code === "RATE_LIMIT_UNAVAILABLE") return SIGN_IN_WORDS.passkey.unavailable;
  if (code === "EMAIL_RATE_LIMITED" || code === "TOO_MANY_REQUESTS")
    return SIGN_IN_WORDS.passkey.limited;
  return SIGN_IN_WORDS.passkey.failed;
}

/**
 * What the email-change page says (`emailLinkResult`'s `done` and `problem`): a title and a sentence each. `settings`
 * names the page where the address is changed ("Settings", "My account").
 * @param {{ siteName: string, settings: string }} site
 */
export function emailLinkWords({ siteName, settings }) {
  return Object.freeze({
    confirm: Object.freeze({
      title: "Confirm your email change",
      text: "Nothing changes until you press the button.",
    }),
    approved: Object.freeze({
      title: "Change approved",
      text: `Now open the link ${siteName} sent to your new address to finish the change.`,
    }),
    changed: Object.freeze({
      title: "Email changed",
      text: `Your ${siteName} account email is changed.`,
    }),
    verified: Object.freeze({ title: "Email confirmed", text: "Your email address is confirmed." }),
    expired: Object.freeze({
      title: "This link has expired",
      text: `Email change links work for ${EMAIL_CHANGE_EXPIRES_IN_WORDS}. Ask for the change again in ${settings}.`,
    }),
    done: Object.freeze({
      title: "This change is already made",
      text: `The link has been used, so it no longer works. Your account email is shown in ${settings}.`,
    }),
    "other-account": Object.freeze({
      title: "This link is for another account",
      text: `This browser is signed in to a different ${siteName} account. Sign out, then open the link again.`,
    }),
    invalid: Object.freeze({
      title: "This link no longer works",
      text: `It is not complete or not valid. Open it from the email again, or ask for the change again in ${settings}.`,
    }),
    failed: Object.freeze({
      title: "The change did not finish",
      text: `Something went wrong on our side. Open the link from the email again, or ask for the change again in ${settings}.`,
    }),
    missing: Object.freeze({
      title: "This link is not complete",
      text: "Part of the link is missing. Open it straight from the email.",
    }),
  });
}

const WAY_IN = Object.freeze({
  link: "an email link",
  code: "an email code",
  passkey: "a passkey",
  google: "Google",
  apple: "Apple",
});
const PROVIDER = Object.freeze({ google: "Google", apple: "Apple" });

/**
 * One row of a person's security history (`securityHistory`) in words: "Signed in with a passkey", "Google connected".
 * @param {{ kind: string, via: string | null }} entry
 */
export function securityHistoryWords({ kind, via }) {
  const way = via ? WAY_IN[/** @type {keyof typeof WAY_IN} */ (via)] : undefined;
  const provider =
    (via && PROVIDER[/** @type {keyof typeof PROVIDER} */ (via)]) ?? "A sign-in method";
  switch (kind) {
    case "sign-in":
      return way ? `Signed in with ${way}` : "Signed in";
    case "passkey-added":
      return "Passkey added";
    case "passkey-removed":
      return "Passkey removed";
    case "sign-in-linked":
      return `${provider} connected`;
    case "sign-in-unlinked":
      return `${provider} disconnected`;
    case "email-changed":
      return "Email address changed";
    case "recovery":
      return "Signed in by email with no passkey left; other devices signed out";
    default:
      return "Account change";
  }
}
