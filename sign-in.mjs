/**
 * The one way a person signs in to any of the family's sites, as Better Auth options a site spreads into its own
 * betterAuth({ ... }) beside its database, sessions and hooks. Chosen 2026-10-24 from current practice (passkeys first,
 * an emailed link as the way in before a passkey exists, social sign-in only where a consumer app wants the reach);
 * admins are not here, they come through Cloudflare Access (`./access`).
 *
 * - PASSKEY: the main way in, phishing-proof because the browser ties it to this site's domain. Its relying party is the
 *   host of BETTER_AUTH_URL, so a passkey made on the live site works only there. The site's headers need
 *   PASSKEY_OVERRIDES (`./headers`), or OSHP's Permissions-Policy refuses every passkey sign-in.
 * - EMAIL LINK: first sign-in, a new device, recovery. No passwords: emailAndPassword is off.
 * - TURNSTILE on the email link when TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are both set (a key without its secret
 *   would show a widget nothing checks; a secret without its key would refuse everyone). The link is the one endpoint
 *   that mails a stranger. The widget is `./turnstile`.
 * - GOOGLE AND APPLE only when the site asks (`social: true`) and has the settings: GOOGLE_CLIENT_ID and
 *   GOOGLE_CLIENT_SECRET; APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY (`./apple-secret` makes the
 *   secret). Apple comes with Google, since an iPhone app that offers Google sign-in must offer Apple's too.
 * - ACCOUNTS ARE JOINED ONLY BY A SIGNED-IN PERSON (linkSocial), never by a matching email at sign-in, the recurring
 *   takeover path.
 * - RATE LIMITED IN THE DATABASE, keyed on Cloudflare's client address: Better Auth counts each request in one atomic
 *   database step, in every environment (not only when NODE_ENV says production), and the magic-link plugin adds its
 *   own five a minute. Sessions and the counts live in the site's D1 (the `session` and `rateLimit` tables), never KV,
 *   which is eventually consistent: a sign-out would take up to a minute to hold and a count could be lost.
 *
 * Async, because Apple's secret is signed with WebCrypto. A site builds its auth once per isolate and keeps the promise.
 */
import { passkey } from "@better-auth/passkey";
import { captcha, magicLink } from "better-auth/plugins";

import { appleClientSecret } from "./apple-secret.mjs";

/** @typedef {Parameters<typeof magicLink>[0]["sendMagicLink"]} SendMagicLink */

/**
 * The Turnstile site key when the check on the email link is on, else null (the form then shows no widget).
 * @param {{ TURNSTILE_SITE_KEY?: string, TURNSTILE_SECRET_KEY?: string }} env
 */
export function turnstileSiteKey(env) {
  return env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY ? env.TURNSTILE_SITE_KEY : null;
}

/**
 * @param {{
 *   BETTER_AUTH_URL: string,
 *   TURNSTILE_SITE_KEY?: string, TURNSTILE_SECRET_KEY?: string,
 *   GOOGLE_CLIENT_ID?: string, GOOGLE_CLIENT_SECRET?: string,
 *   APPLE_CLIENT_ID?: string, APPLE_TEAM_ID?: string, APPLE_KEY_ID?: string, APPLE_PRIVATE_KEY?: string,
 * }} env
 * @param {{ siteName: string, sendMagicLink: SendMagicLink, social?: boolean }} site
 */
export async function signInOptions(env, { siteName, sendMagicLink, social = false }) {
  const url = new URL(env.BETTER_AUTH_URL);
  /** @type {any[]} */
  const plugins = [magicLink({ sendMagicLink }), passkey({ rpID: url.hostname, rpName: siteName, origin: url.origin })];
  if (turnstileSiteKey(env) && env.TURNSTILE_SECRET_KEY) {
    plugins.push(
      captcha({ provider: "cloudflare-turnstile", secretKey: env.TURNSTILE_SECRET_KEY, endpoints: ["/sign-in/magic-link"] }),
    );
  }

  /** @type {Record<string, { clientId: string, clientSecret: string }>} */
  const socialProviders = {};
  if (social && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
  }
  const appleSecret = social ? await appleClientSecret(env) : null;
  if (appleSecret && env.APPLE_CLIENT_ID) {
    socialProviders.apple = { clientId: env.APPLE_CLIENT_ID, clientSecret: appleSecret };
  }

  return {
    emailAndPassword: { enabled: false },
    plugins,
    socialProviders,
    account: { accountLinking: { enabled: true, disableImplicitLinking: true } },
    rateLimit: { enabled: true, storage: "database" },
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    // Apple returns to the site with a form POST from its own origin.
    trustedOrigins: socialProviders.apple ? ["https://appleid.apple.com"] : [],
  };
}

/** Which buttons a sign-in page shows, for its loader to hand the page. */
/** @param {Parameters<typeof signInOptions>[0]} env */
export function signInMethods(env, { social = false } = {}) {
  return {
    google: social && Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    apple: social && Boolean(env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY),
    turnstileSiteKey: turnstileSiteKey(env),
  };
}
