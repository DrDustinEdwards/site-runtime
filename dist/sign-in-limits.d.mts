/** The sign-in's paths, lifetimes and rate rules: a leaf the plugin modules and `./sign-in` share, so none imports back. */
/** Where a page posts the code: Better Auth's email OTP sign-in, which signs in, or makes the account, as the link does. */
export const SIGN_IN_CODE_PATH: "/sign-in/email-otp";
/** Where a phone app asks for a code alone (`appCode: true`): the email OTP plugin's own send endpoint. */
export const APP_CODE_PATH: "/email-otp/send-verification-otp";
/** The app's code request, held tighter than the default: three a minute, since no Turnstile sits in front of it. */
export const APP_CODE_RATE_LIMIT: Readonly<{
    window: 60;
    max: 3;
}>;
/**
 * How long a session lasts from its sign-in, however much it is used: 30 days, NIST SP 800-63B-4's overall timeout for
 * AAL1. Better Auth's default slides forward with every use; refresh is off, so this is a cap.
 */
export const SESSION_SECONDS: number;
/**
 * How long a session may sit unused before it ends: 7 days. OWASP ASVS 5 v7.3.1 (L2) asks for an inactivity timeout
 * set by risk; NIST SP 800-63B-4 sets none at AAL1, and Admin gets its hour from Cloudflare Access (`ADMIN_IDLE_SECONDS`).
 */
export const SESSION_IDLE_SECONDS: number;
/** Sign-in mails per address: five an hour, Foxhound's limit (the link request, and the app's code request). */
export const LINK_EMAIL_RULES: readonly Readonly<{
    limit: 5;
    windowSeconds: number;
}>[];
/**
 * Wrong sign-in codes per address, across links: three an hour (a code's own three tries) and ten a day. A new link
 * brings a new code but no fresh tries; the link itself still works.
 */
export const CODE_EMAIL_RULES: readonly (Readonly<{
    limit: 3;
    windowSeconds: number;
}> | Readonly<{
    limit: 10;
    windowSeconds: number;
}>)[];
/** Failed passkey or social sign-ins per address: ten an hour. */
export const SIGN_IN_FAILURE_RULES: readonly Readonly<{
    limit: 10;
    windowSeconds: number;
}>[];
/** Failed sign-ins per passkey (credential id): 100 in 30 days, NIST SP 800-63B-4's cap per authenticator. */
export const PASSKEY_FAILURE_RULES: readonly Readonly<{
    limit: 100;
    windowSeconds: number;
}>[];
/** The one value of `turnstile` that lets the link request through without keys, until the site has them. */
export const TURNSTILE_OFF_UNTIL_KEYS: "off-until-keys";
