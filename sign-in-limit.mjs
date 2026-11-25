import { tryGetCurrentAuthEndpointContext } from "@better-auth/core/context";
import { APIError, createAuthMiddleware, getOAuthState } from "better-auth/api";

import { OWASP_EVENTS, logEvent } from "./log.mjs";
import { emailKey, limit, mustStop } from "./rate-limit/index.mjs";
import { logAuthEvent, outcome } from "./sign-in-account.mjs";
import {
  APP_CODE_PATH,
  CODE_EMAIL_RULES,
  LINK_EMAIL_RULES,
  PASSKEY_FAILURE_RULES,
  SIGN_IN_CODE_PATH,
  SIGN_IN_FAILURE_RULES,
} from "./sign-in-limits.mjs";

/** The endpoints whose mails spend an address's budget, counted on each request. */
const MAIL_LIMITED = new Set(["/sign-in/magic-link", APP_CODE_PATH]);

/** The address Google or Apple named in a web sign-in's callback, by the request's auth context (`providerAddress`). */
const callbackAddress = new WeakMap();

/**
 * The providers' `mapProfileToUser`: it maps nothing, and notes the address the provider answered with for the
 * callback's request, so a failed callback counts against it. When that address is already over
 * SIGN_IN_FAILURE_RULES the callback stops here, before any account is read, and goes back to the sign-in's error page
 * with `?error=EMAIL_RATE_LIMITED`.
 * @param {Parameters<typeof limit>[0] | undefined} namespace
 */
export function providerAddress(namespace) {
  return async (/** @type {{ email?: unknown }} */ profile) => {
    const ctx = /** @type {any} */ (tryGetCurrentAuthEndpointContext());
    const key =
      typeof profile?.email === "string" ? await emailKey("sign-in-fail", profile.email) : null;
    if (!ctx?.context || !key || !namespace) return {};
    callbackAddress.set(ctx.context, key);
    const verdict = await limit(namespace, key, [...SIGN_IN_FAILURE_RULES], {
      onUnavailable: "allow",
      peek: true,
    });
    if (!mustStop(verdict, "allow")) return {};
    await logAuthEvent({
      event: OWASP_EVENTS.rateLimitExceeded,
      fields: { endpoint: ctx.path, bucket: "sign-in-fail" },
      level: "warn",
    });
    const state = await getOAuthState().catch(() => null);
    const back = new URL(state?.errorURL || state?.callbackURL || "/", ctx.context.baseURL);
    back.searchParams.set("error", "EMAIL_RATE_LIMITED");
    throw new APIError("FOUND", undefined, new Headers({ location: back.toString() }));
  };
}

/**
 * The address a failed passkey or social sign-in counts against, and the passkey's own key. A failure counts against
 * an address only when the request proved something about it, so nobody can spend a person's budget by naming them
 * a passkey's owner, by a credential id that is a real passkey, or the
 * address the provider answered a web callback with (`providerAddress`), after the provider checked the person. The
 * app's ID token names an address it has not proved (it fails before its signature checks out), and a callback
 * before the provider answers names none, so Better Auth's per-IP limit is all that holds those.
 * @param {any} ctx
 * @returns {Promise<{ address: string | null, passkey: string | null }>}
 */
async function failureKeys(ctx) {
  if (ctx.path === "/callback/:id")
    return { address: callbackAddress.get(ctx.context) ?? null, passkey: null };
  if (ctx.path === "/passkey/verify-authentication") {
    const id = ctx.body?.response?.id;
    if (typeof id !== "string" || !id) return { address: null, passkey: null };
    const row = await ctx.context.adapter.findOne({
      model: "passkey",
      where: [{ field: "credentialID", value: id }],
    });
    const user = row ? await ctx.context.internalAdapter.findUserById(row.userId) : null;
    return {
      address: await emailKey("sign-in-fail", user?.email),
      passkey: await emailKey("passkey-fail", id),
    };
  }
  return { address: null, passkey: null };
}

/**
 * Whether the address has a live sign-in code, as the email OTP plugin stores it. A wrong code counts against an
 * address only then: a code typed when none was sent proves nothing about the address, so it is held per IP alone.
 * After a wrong guess the plugin puts the code back with one more try spent, so the after hook still finds it.
 * @param {any} ctx @param {unknown} email
 */
async function hasPendingCode(ctx, email) {
  if (typeof email !== "string" || !email) return false;
  const row = await ctx.context.internalAdapter.findVerificationValue(
    `sign-in-otp-${email.toLowerCase()}`,
  );
  return Boolean(row) && new Date(row.expiresAt) > new Date();
}

/** The endpoints whose failures count against an address and a passkey. */
const FAILURE_LIMITED = new Set(["/passkey/verify-authentication", "/callback/:id"]);

/**
 * The per-address limits as one plugin. Its before hooks run after the captcha plugin and Better Auth's per-IP limit
 * (both on the request, before any hook), so a request without a Turnstile pass spends nothing of an address's budget.
 * A mail is counted when asked for; a typed code, a passkey and a social sign-in are checked before (a peek, which
 * counts nothing) and counted only when they fail, in the after hook. A code is refused when the counter cannot
 * answer, and so is every code on a site with no `emailLimiter`; a mail or a passkey goes through.
 * @param {Parameters<typeof limit>[0] | undefined} namespace
 */
export function emailLimit(namespace) {
  /**
   * @param {string} path @param {string} bucket @param {import("./rate-limit/limit.mjs").Verdict} verdict @param {unknown} email
   */
  const refuse = async (path, bucket, verdict, email) => {
    if (verdict.status === "unavailable") {
      throw new APIError("SERVICE_UNAVAILABLE", {
        code: "RATE_LIMIT_UNAVAILABLE",
        message: "Use the link in the email, or try again in a minute.",
      });
    }
    await logAuthEvent({
      event: OWASP_EVENTS.rateLimitExceeded,
      fields: { endpoint: path, bucket },
      level: "warn",
      email,
    });
    throw new APIError(
      "TOO_MANY_REQUESTS",
      { code: "EMAIL_RATE_LIMITED", message: "Too many tries for this address. Try again later." },
      { "Retry-After": String(verdict.retryAfterSeconds) },
    );
  };
  return {
    id: "sign-in-email-limit",
    hooks: {
      before: [
        {
          /** @param {{ path?: string }} ctx */
          matcher: (ctx) => Boolean(namespace) && MAIL_LIMITED.has(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const key = await emailKey("link-email", ctx.body?.email);
            if (!key) return;
            const verdict = await limit(namespace, key, [...LINK_EMAIL_RULES], {
              onUnavailable: "allow",
            });
            if (mustStop(verdict, "allow"))
              await refuse(ctx.path, "link-email", verdict, ctx.body?.email);
          }),
        },
        {
          /** @param {{ path?: string }} ctx */
          matcher: (ctx) => ctx.path === SIGN_IN_CODE_PATH,
          handler: createAuthMiddleware(async (ctx) => {
            const key = await emailKey("code-email", ctx.body?.email);
            if (!key) return;
            const verdict = await limit(namespace, key, [...CODE_EMAIL_RULES], {
              onUnavailable: "refuse",
              peek: true,
            });
            if (mustStop(verdict, "refuse"))
              await refuse(ctx.path, "code-email", verdict, ctx.body?.email);
          }),
        },
        {
          /** @param {{ path?: string }} ctx */
          matcher: (ctx) => Boolean(namespace) && FAILURE_LIMITED.has(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const keys = await failureKeys(ctx);
            for (const [key, rules, bucket] of /** @type {const} */ ([
              [keys.passkey, PASSKEY_FAILURE_RULES, "passkey-fail"],
              [keys.address, SIGN_IN_FAILURE_RULES, "sign-in-fail"],
            ])) {
              if (!key) continue;
              const verdict = await limit(namespace, key, [...rules], {
                onUnavailable: "allow",
                peek: true,
              });
              if (mustStop(verdict, "allow")) await refuse(ctx.path, bucket, verdict, undefined);
            }
          }),
        },
      ],
      after: [
        {
          /** @param {{ path?: string }} ctx */
          matcher: (ctx) =>
            Boolean(namespace) &&
            (ctx.path === SIGN_IN_CODE_PATH || FAILURE_LIMITED.has(ctx.path ?? "")),
          handler: createAuthMiddleware(async (ctx) => {
            try {
              if (ctx.context.newSession || outcome(ctx.context.returned).ok) return;
              if (ctx.path === SIGN_IN_CODE_PATH) {
                const key = await emailKey("code-email", ctx.body?.email);
                if (key && (await hasPendingCode(ctx, ctx.body?.email)))
                  await limit(namespace, key, [...CODE_EMAIL_RULES], { onUnavailable: "allow" });
                return;
              }
              const keys = await failureKeys(ctx);
              if (keys.passkey)
                await limit(namespace, keys.passkey, [...PASSKEY_FAILURE_RULES], {
                  onUnavailable: "allow",
                });
              if (keys.address)
                await limit(namespace, keys.address, [...SIGN_IN_FAILURE_RULES], {
                  onUnavailable: "allow",
                });
            } catch (error) {
              logEvent("auth_event_failed", { error }, { level: "error" });
            }
          }),
        },
      ],
    },
  };
}
