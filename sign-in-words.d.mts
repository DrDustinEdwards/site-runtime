export { SIGN_IN_EXPIRES_IN_WORDS, SIGN_IN_LINK_WORDS } from "./sign-in-link.mjs";

/** Better Auth's error code when a new account's address is at a disposable domain. */
export const DISPOSABLE_EMAIL: "disposable_email";

/** The words every site's sign-in pages say, by answer. */
export const SIGN_IN_WORDS: Readonly<{
  noEmail: string;
  noCode: string;
  link: Readonly<
    Record<"limited" | "email-limited" | "check-failed" | "unavailable" | "failed", string>
  >;
  code: Readonly<
    Record<
      | "wrong"
      | "expired"
      | "spent"
      | "limited"
      | "email-limited"
      | "unavailable"
      | "disposable"
      | "failed",
      string
    >
  >;
  passkey: Readonly<Record<"failed" | "limited" | "unavailable", string>>;
}>;

/**
 * The words for a `?error=` code a sign-in page is sent back with, or null for none. `settings` names where the person
 * joins Google or Apple to the account ("Settings", "My account").
 */
export function signInErrorWords(
  code: string | null | undefined,
  site: { siteName: string; settings: string },
): string | null;

/** The words for a passkey sign-in that did not sign in, or null when the person canceled the prompt. */
export function passkeyErrorWords(error: unknown): string | null;
